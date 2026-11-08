use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::events::{Category, FioreEvent, Mood, MusicState, Season, Snapshot};
use crate::sensors::Sensor;

#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error("hub channel closed")]
    Closed,
    #[error("emit failed: {0}")]
    Emit(String),
    #[error("thread spawn failed: {0}")]
    Spawn(String),
}

impl Serialize for HubError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub trait EventSink {
    fn emit(&self, event: &FioreEvent) -> Result<(), HubError>;
}

#[derive(Debug)]
pub enum HubMsg {
    Event(FioreEvent),
    /// Debug/injected event: folded into state but always forwarded as sent.
    Inject(FioreEvent),
    FrontendReady,
}

#[derive(Clone)]
pub struct HubHandle {
    pub tx: Sender<HubMsg>,
}

impl HubHandle {
    pub fn send_inject(&self, event: FioreEvent) -> Result<(), HubError> {
        self.tx
            .send(HubMsg::Inject(event))
            .map_err(|_| HubError::Closed)
    }

    pub fn request_frontend_ready(&self) -> Result<(), HubError> {
        self.tx
            .send(HubMsg::FrontendReady)
            .map_err(|_| HubError::Closed)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Fields {
    activity: Category,
    mood: Mood,
    season: Season,
    fullscreen: bool,
    music: MusicState,
}

#[derive(Debug, Clone, Copy, Default)]
struct Seen {
    activity: bool,
    mood: bool,
    season: bool,
    fullscreen: bool,
    music: bool,
}

pub struct Hub {
    fields: Fields,
    seen: Seen,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            fields: Fields {
                activity: Category::Other,
                mood: Mood::Content,
                season: Season::Autumn,
                fullscreen: false,
                music: MusicState {
                    playing: false,
                    title: None,
                    artist: None,
                    source_app: None,
                },
            },
            seen: Seen::default(),
        }
    }

    pub fn snapshot_event(&self) -> FioreEvent {
        FioreEvent::StateSnapshot(Snapshot {
            activity: self.fields.activity,
            mood: self.fields.mood,
            season: self.fields.season,
            fullscreen: self.fields.fullscreen,
            music: self.fields.music.clone(),
        })
    }

    pub fn on_frontend_ready(&self) -> Vec<FioreEvent> {
        vec![self.snapshot_event()]
    }

    /// Injected (debug) path. Folds the value like a sensor report (field and
    /// seen flag) so later sensor events dedupe correctly, but always forwards
    /// the original event: no baseline swap, no duplicate drop.
    pub fn inject(&mut self, event: FioreEvent) -> Vec<FioreEvent> {
        let _folded = self.handle(event.clone());
        vec![event]
    }

    /// Sensor path. The first report of each state field becomes `state.snapshot`.
    pub fn handle(&mut self, event: FioreEvent) -> Vec<FioreEvent> {
        match event {
            FioreEvent::AppCategoryChanged {
                category,
                process,
                title,
            } => self.fold_copy(
                category,
                FioreEvent::AppCategoryChanged {
                    category,
                    process,
                    title,
                },
                |fields| &mut fields.activity,
                |seen| &mut seen.activity,
            ),
            FioreEvent::TimeMoodChanged { mood } => self.fold_copy(
                mood,
                FioreEvent::TimeMoodChanged { mood },
                |fields| &mut fields.mood,
                |seen| &mut seen.mood,
            ),
            FioreEvent::SeasonChanged { season } => self.fold_copy(
                season,
                FioreEvent::SeasonChanged { season },
                |fields| &mut fields.season,
                |seen| &mut seen.season,
            ),
            FioreEvent::FullscreenEntered {} => self.fold_copy(
                true,
                FioreEvent::FullscreenEntered {},
                |fields| &mut fields.fullscreen,
                |seen| &mut seen.fullscreen,
            ),
            FioreEvent::FullscreenExited {} => self.fold_copy(
                false,
                FioreEvent::FullscreenExited {},
                |fields| &mut fields.fullscreen,
                |seen| &mut seen.fullscreen,
            ),
            FioreEvent::MusicStarted {
                title,
                artist,
                source_app,
            } => {
                let next = MusicState {
                    playing: true,
                    title: Some(title.clone()),
                    artist: Some(artist.clone()),
                    source_app: Some(source_app.clone()),
                };
                self.fold_music(
                    next,
                    FioreEvent::MusicStarted {
                        title,
                        artist,
                        source_app,
                    },
                )
            }
            FioreEvent::MusicTrackChanged { title, artist } => {
                let mut next = self.fields.music.clone();
                next.playing = true;
                next.title = Some(title.clone());
                next.artist = Some(artist.clone());
                self.fold_music(next, FioreEvent::MusicTrackChanged { title, artist })
            }
            FioreEvent::MusicStopped {} => self.fold_music(
                MusicState {
                    playing: false,
                    title: None,
                    artist: None,
                    source_app: None,
                },
                FioreEvent::MusicStopped {},
            ),
            FioreEvent::MusicLevel { .. } => {
                if self.fields.music.playing {
                    vec![event]
                } else {
                    Vec::new()
                }
            }
            FioreEvent::StateSnapshot(snapshot) => {
                self.fields.activity = snapshot.activity;
                self.fields.mood = snapshot.mood;
                self.fields.season = snapshot.season;
                self.fields.fullscreen = snapshot.fullscreen;
                self.fields.music = snapshot.music.clone();
                self.seen.activity = true;
                self.seen.mood = true;
                self.seen.season = true;
                self.seen.fullscreen = true;
                self.seen.music = true;
                vec![FioreEvent::StateSnapshot(snapshot)]
            }
            FioreEvent::PetDragStart {}
            | FioreEvent::PetDragEnd {}
            | FioreEvent::PetHoverStart {}
            | FioreEvent::PetStroke { .. }
            | FioreEvent::PetPetted {}
            | FioreEvent::PetHoverEnd { .. } => vec![event],
        }
    }

    fn fold_copy<T: Copy + PartialEq>(
        &mut self,
        next: T,
        event: FioreEvent,
        slot: impl Fn(&mut Fields) -> &mut T,
        flag: impl Fn(&mut Seen) -> &mut bool,
    ) -> Vec<FioreEvent> {
        if !*flag(&mut self.seen) {
            *slot(&mut self.fields) = next;
            *flag(&mut self.seen) = true;
            return vec![self.snapshot_event()];
        }
        if *slot(&mut self.fields) == next {
            return Vec::new();
        }
        *slot(&mut self.fields) = next;
        vec![event]
    }

    fn fold_music(&mut self, next: MusicState, event: FioreEvent) -> Vec<FioreEvent> {
        if !self.seen.music {
            self.fields.music = next;
            self.seen.music = true;
            return vec![self.snapshot_event()];
        }
        if self.fields.music == next {
            return Vec::new();
        }
        self.fields.music = next;
        vec![event]
    }
}

struct TauriSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> EventSink for TauriSink<R> {
    fn emit(&self, event: &FioreEvent) -> Result<(), HubError> {
        self.app
            .emit("fiore://event", event.clone())
            .map_err(|err| HubError::Emit(err.to_string()))
    }
}

pub fn start<R: Runtime>(
    app: &AppHandle<R>,
    sensors: Vec<Box<dyn Sensor>>,
) -> Result<(), HubError> {
    let (tx, rx) = mpsc::channel();
    let handle = HubHandle { tx: tx.clone() };
    app.manage(handle);

    let sensor_tx = sensor_sender(tx);
    let _threads = spawn_sensor_threads(sensors, sensor_tx);

    let sink = TauriSink { app: app.clone() };
    thread::Builder::new()
        .name("fiore-hub".to_string())
        .spawn(move || run_hub(rx, sink))
        .map_err(|err| HubError::Spawn(err.to_string()))?;
    Ok(())
}

fn run_hub<S: EventSink>(rx: Receiver<HubMsg>, sink: S) {
    let mut hub = Hub::new();
    deliver(&sink, vec![hub.snapshot_event()]);
    while let Ok(msg) = rx.recv() {
        let outgoing = match msg {
            HubMsg::Event(event) => hub.handle(event),
            HubMsg::Inject(event) => hub.inject(event),
            HubMsg::FrontendReady => hub.on_frontend_ready(),
        };
        deliver(&sink, outgoing);
    }
}

fn deliver<S: EventSink>(sink: &S, events: Vec<FioreEvent>) {
    for event in events {
        if let Err(err) = sink.emit(&event) {
            tracing::debug!(error = %err, "dropped hub event");
        }
    }
}

fn sensor_sender(tx: Sender<HubMsg>) -> Sender<FioreEvent> {
    let (event_tx, event_rx) = mpsc::channel();
    let _ = thread::Builder::new()
        .name("fiore-sensor-ingress".to_string())
        .spawn(move || {
            while let Ok(event) = event_rx.recv() {
                if tx.send(HubMsg::Event(event)).is_err() {
                    break;
                }
            }
        });
    event_tx
}

pub fn spawn_sensor_threads(
    sensors: Vec<Box<dyn Sensor>>,
    tx: Sender<FioreEvent>,
) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::with_capacity(sensors.len());
    for sensor in sensors {
        let name = sensor.name().to_string();
        let thread_name = name.clone();
        let tx = tx.clone();
        match thread::Builder::new()
            .name(format!("fiore-sensor-{name}"))
            .spawn(move || {
                let started = catch_unwind(AssertUnwindSafe(|| sensor.start(tx)));
                match started {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => {
                        tracing::warn!(sensor = %thread_name, error = %err, "sensor disabled");
                    }
                    Err(_payload) => {
                        tracing::error!(sensor = %thread_name, "sensor panicked; disabled");
                    }
                }
            }) {
            Ok(handle) => handles.push(handle),
            Err(err) => {
                tracing::error!(sensor = %name, error = %err, "sensor thread failed to spawn");
            }
        }
    }
    handles
}

#[tauri::command]
pub fn frontend_ready(hub: State<'_, HubHandle>) -> Result<(), HubError> {
    hub.request_frontend_ready()
}

#[cfg(test)]
mod tests {
    // Assertions, plus one fake sensor that panics on purpose (AC-X-2).
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::events::{Category, Mood};
    use crate::sensors::SensorError;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn category(category: Category) -> FioreEvent {
        FioreEvent::AppCategoryChanged {
            category,
            process: "Code.exe".to_string(),
            title: "main.rs".to_string(),
        }
    }

    #[test]
    fn ac_sn_1_baseline_emits_snapshot_without_change_event() {
        let mut hub = Hub::new();
        let out = hub.handle(category(Category::Coding));
        assert_eq!(out.len(), 1);
        match &out[0] {
            FioreEvent::StateSnapshot(snapshot) => {
                assert_eq!(snapshot.activity, Category::Coding);
            }
            other => panic!("expected snapshot, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_category_is_dropped() {
        let mut hub = Hub::new();
        let _ = hub.handle(category(Category::Coding));
        assert!(hub.handle(category(Category::Coding)).is_empty());
        let changed = category(Category::Writing);
        assert_eq!(hub.handle(changed.clone()), vec![changed]);
    }

    #[test]
    fn ac_mu_3_level_dropped_while_stopped() {
        let mut hub = Hub::new();
        assert!(hub.handle(FioreEvent::MusicLevel { peak: 0.9 }).is_empty());

        let started = FioreEvent::MusicStarted {
            title: "Song".to_string(),
            artist: "Artist".to_string(),
            source_app: "Spotify.exe".to_string(),
        };
        let baseline = hub.handle(started);
        assert!(matches!(
            baseline.first(),
            Some(FioreEvent::StateSnapshot(_))
        ));

        let level = FioreEvent::MusicLevel { peak: 0.25 };
        assert_eq!(hub.handle(level.clone()), vec![level]);
    }

    #[test]
    fn injected_state_event_passes_through_before_baseline() {
        let mut hub = Hub::new();
        let fullscreen = FioreEvent::FullscreenEntered {};
        assert_eq!(hub.inject(fullscreen.clone()), vec![fullscreen.clone()]);
        // A repeat is not dropped.
        assert_eq!(hub.inject(fullscreen.clone()), vec![fullscreen]);

        let mood = FioreEvent::TimeMoodChanged { mood: Mood::Sleepy };
        assert_eq!(hub.inject(mood.clone()), vec![mood]);

        let season = FioreEvent::SeasonChanged {
            season: Season::Winter,
        };
        assert_eq!(hub.inject(season.clone()), vec![season]);

        // Folded: the snapshot reflects injected values, and a sensor report of
        // the same value is now a duplicate (baseline already seen).
        match hub.on_frontend_ready().first() {
            Some(FioreEvent::StateSnapshot(snapshot)) => {
                assert!(snapshot.fullscreen);
                assert_eq!(snapshot.mood, Mood::Sleepy);
                assert_eq!(snapshot.season, Season::Winter);
            }
            other => panic!("expected snapshot, got {other:?}"),
        }
        assert!(hub.handle(FioreEvent::FullscreenEntered {}).is_empty());

        // Music level injected while stopped still passes through.
        let level = FioreEvent::MusicLevel { peak: 0.5 };
        assert_eq!(hub.inject(level.clone()), vec![level]);
    }

    #[test]
    fn frontend_ready_resends_current_snapshot() {
        let mut hub = Hub::new();
        let _ = hub.handle(FioreEvent::TimeMoodChanged { mood: Mood::Sleepy });
        let out = hub.on_frontend_ready();
        match out.first() {
            Some(FioreEvent::StateSnapshot(snapshot)) => assert_eq!(snapshot.mood, Mood::Sleepy),
            other => panic!("expected snapshot, got {other:?}"),
        }
    }

    #[test]
    fn pet_events_pass_through() {
        let mut hub = Hub::new();
        let event = FioreEvent::PetPetted {};
        assert_eq!(hub.handle(event.clone()), vec![event]);
    }

    struct Probe {
        name: &'static str,
        flag: Arc<AtomicBool>,
        kind: Kind,
    }

    enum Kind {
        Ok,
        Fail,
        Panic,
    }

    impl Sensor for Probe {
        fn name(&self) -> &'static str {
            self.name
        }

        fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
            match self.kind {
                Kind::Ok => {
                    self.flag.store(true, Ordering::SeqCst);
                    Ok(())
                }
                Kind::Fail => Err(SensorError::Failed("boom".to_string())),
                Kind::Panic => panic!("sensor boom"),
            }
        }
    }

    #[test]
    fn ac_x_2_failing_and_panicking_sensors_do_not_stop_others() {
        let flag = Arc::new(AtomicBool::new(false));
        let sensors: Vec<Box<dyn Sensor>> = vec![
            Box::new(Probe {
                name: "bad",
                flag: Arc::clone(&flag),
                kind: Kind::Fail,
            }),
            Box::new(Probe {
                name: "panic",
                flag: Arc::clone(&flag),
                kind: Kind::Panic,
            }),
            Box::new(Probe {
                name: "ok",
                flag: Arc::clone(&flag),
                kind: Kind::Ok,
            }),
        ];
        let (tx, _rx) = mpsc::channel();
        let handles = spawn_sensor_threads(sensors, tx);
        assert_eq!(handles.len(), 3);
        for handle in handles {
            handle.join().expect("sensor thread");
        }
        assert!(flag.load(Ordering::SeqCst));
    }
}
