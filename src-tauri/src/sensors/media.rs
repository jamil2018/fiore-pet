//! Platform playback sensor: `music.started`, `music.track_changed`, `music.stopped`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::time::Instant;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

/// Set when `music.started` is emitted and cleared when `music.stopped` is emitted.
/// `audio_peak` reads this so the meter stays idle while nothing is playing.
pub(super) static MUSIC_PLAYING: AtomicBool = AtomicBool::new(false);

const STOP_HOLD_MS: u64 = 2_000;
const POLL_MS: u64 = 500;
#[cfg(windows)]
const BACKOFF_START_MS: u64 = 1_000;
#[cfg(windows)]
const BACKOFF_CAP_MS: u64 = 30_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub source_app: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
enum Phase {
    #[default]
    Fresh,
    Stopped,
    Playing(Track),
    Holding {
        track: Track,
        since: u64,
    },
}

#[derive(Debug, Default)]
pub struct MusicTracker {
    phase: Phase,
}

impl MusicTracker {
    /// First sample is the baseline (`started` or `stopped`). Later samples emit on change.
    /// A gap shorter than 2s emits nothing. Empty titles do not count as a track change.
    pub fn sample(&mut self, now_playing: Option<Track>, now_ms: u64) -> Vec<FioreEvent> {
        match std::mem::replace(&mut self.phase, Phase::Fresh) {
            Phase::Fresh => self.baseline(now_playing),
            Phase::Stopped => match now_playing {
                Some(track) => self.start_playing(track),
                None => {
                    self.phase = Phase::Stopped;
                    Vec::new()
                }
            },
            Phase::Playing(track) => self.while_playing(track, now_playing, now_ms),
            Phase::Holding { track, since } => {
                self.while_holding(track, since, now_playing, now_ms)
            }
        }
    }

    fn baseline(&mut self, now_playing: Option<Track>) -> Vec<FioreEvent> {
        match now_playing {
            Some(track) => self.start_playing(track),
            None => self.stop_playing(),
        }
    }

    fn while_playing(
        &mut self,
        track: Track,
        now_playing: Option<Track>,
        now_ms: u64,
    ) -> Vec<FioreEvent> {
        match now_playing {
            Some(next) => self.update_track(track, next),
            None => {
                self.phase = Phase::Holding {
                    track,
                    since: now_ms,
                };
                Vec::new()
            }
        }
    }

    fn while_holding(
        &mut self,
        track: Track,
        since: u64,
        now_playing: Option<Track>,
        now_ms: u64,
    ) -> Vec<FioreEvent> {
        match now_playing {
            Some(next) => self.update_track(track, next),
            None if now_ms.saturating_sub(since) >= STOP_HOLD_MS => self.stop_playing(),
            None => {
                self.phase = Phase::Holding { track, since };
                Vec::new()
            }
        }
    }

    fn update_track(&mut self, current: Track, next: Track) -> Vec<FioreEvent> {
        if next.title.is_empty() || (next.title == current.title && next.artist == current.artist) {
            self.phase = Phase::Playing(if next.title.is_empty() { current } else { next });
            return Vec::new();
        }
        let event = FioreEvent::MusicTrackChanged {
            title: next.title.clone(),
            artist: next.artist.clone(),
        };
        self.phase = Phase::Playing(next);
        vec![event]
    }

    fn start_playing(&mut self, track: Track) -> Vec<FioreEvent> {
        let event = FioreEvent::MusicStarted {
            title: track.title.clone(),
            artist: track.artist.clone(),
            source_app: track.source_app.clone(),
        };
        self.phase = Phase::Playing(track);
        MUSIC_PLAYING.store(true, Ordering::Release);
        vec![event]
    }

    fn stop_playing(&mut self) -> Vec<FioreEvent> {
        self.phase = Phase::Stopped;
        MUSIC_PLAYING.store(false, Ordering::Release);
        vec![FioreEvent::MusicStopped {}]
    }
}

/// Prefer the current session when it is playing; otherwise the first playing session.
#[derive(Debug, PartialEq, Eq)]
#[cfg(any(windows, test))]
enum SessionChoice {
    Current,
    Index(usize),
    None,
}

#[cfg(any(windows, test))]
fn select_session(current_playing: bool, others: &[bool]) -> SessionChoice {
    if current_playing {
        return SessionChoice::Current;
    }
    match others.iter().position(|playing| *playing) {
        Some(index) => SessionChoice::Index(index),
        None => SessionChoice::None,
    }
}

pub struct MediaSensor;

impl Sensor for MediaSensor {
    fn name(&self) -> &'static str {
        "media"
    }

    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        #[cfg(windows)]
        {
            gsmtc::run(tx)
        }
        #[cfg(target_os = "macos")]
        {
            mac_media::run(tx)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = tx;
            tracing::debug!(sensor = "media", "unsupported platform");
            Ok(())
        }
    }
}

#[cfg(any(target_os = "macos", test))]
mod mac_media {
    use super::{failed, MusicTracker, Track};
    use crate::events::FioreEvent;
    use crate::sensors::SensorError;
    use serde::Deserialize;
    use std::sync::mpsc::Sender;

    #[derive(Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum Status {
        Ok,
        Unavailable,
        Denied,
        Error,
    }

    #[derive(Deserialize)]
    struct Snapshot {
        status: Status,
        playing: bool,
        title: String,
        artist: String,
        source_app: String,
    }

    impl Snapshot {
        fn playing(self) -> Result<Option<Track>, SensorError> {
            match self.status {
                Status::Error => Err(failed("macOS media bridge failed")),
                Status::Denied | Status::Unavailable => Ok(None),
                Status::Ok if !self.playing => Ok(None),
                Status::Ok => {
                    if !matches!(
                        self.source_app.as_str(),
                        "com.apple.Music"
                            | "com.spotify.client"
                            | "com.google.Chrome"
                            | "com.apple.Safari"
                            | "com.microsoft.edgemac"
                            | "com.brave.Browser"
                    ) {
                        return Err(failed("macOS media bridge returned an unknown player"));
                    }
                    Ok(Some(Track {
                        title: self.title,
                        artist: self.artist,
                        source_app: self.source_app,
                    }))
                }
            }
        }
    }

    trait MediaSource {
        fn poll(&mut self) -> Result<Option<Track>, SensorError>;
    }

    fn tick(
        source: &mut impl MediaSource,
        tracker: &mut MusicTracker,
        tx: &Sender<FioreEvent>,
        now: u64,
    ) -> Result<bool, SensorError> {
        let playing = match source.poll() {
            Ok(playing) => playing,
            Err(err) => {
                // Do not leave headphones or the audio meter running after a
                // fatal bridge failure disables this sensor.
                for event in tracker.stop_playing() {
                    let _ = tx.send(event);
                }
                return Err(err);
            }
        };
        for event in tracker.sample(playing, now) {
            if tx.send(event).is_err() {
                return Ok(false);
            }
        }
        Ok(true)
    }

    #[cfg(target_os = "macos")]
    pub(super) fn run(tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        struct NativeMedia;
        impl MediaSource for NativeMedia {
            fn poll(&mut self) -> Result<Option<Track>, SensorError> {
                unsafe extern "C" {
                    fn fiore_macos_media_snapshot(
                        probe: *const std::ffi::c_char,
                    ) -> *mut std::ffi::c_char;
                }
                const PROBE: &str =
                    concat!(include_str!("../../native/macos/browser_probe.js"), "\0");
                // SAFETY: probe is a static NUL-terminated UTF-8 script; native code
                // only reads it during this call and returns malloc-owned JSON.
                let ptr = unsafe { fiore_macos_media_snapshot(PROBE.as_ptr().cast()) };
                crate::sensors::macos::snapshot::<Snapshot>(ptr)?.playing()
            }
        }
        let mut source = NativeMedia;
        let mut tracker = MusicTracker::default();
        let origin = std::time::Instant::now();
        while tick(&mut source, &mut tracker, &tx, super::elapsed_ms(origin))? {
            std::thread::sleep(std::time::Duration::from_millis(super::POLL_MS));
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::sensors::media::{test_flag_lock, MUSIC_PLAYING};
        use std::sync::atomic::Ordering;

        fn parse(status: &str, playing: bool, app: &str) -> Result<Snapshot, serde_json::Error> {
            serde_json::from_value(serde_json::json!({
                "status": status, "playing": playing, "title": "A",
                "artist": "B", "source_app": app
            }))
        }

        #[test]
        fn authorized_players_preserve_metadata_and_absence_is_not_failure(
        ) -> Result<(), Box<dyn std::error::Error>> {
            for app in [
                "com.apple.Music",
                "com.spotify.client",
                "com.google.Chrome",
                "com.apple.Safari",
                "com.microsoft.edgemac",
                "com.brave.Browser",
            ] {
                let track = parse("ok", true, app)?
                    .playing()?
                    .ok_or("expected playing track")?;
                assert_eq!(track.source_app, app);
                assert_eq!(track.title, "A");
                assert_eq!(track.artist, "B");
                assert_eq!(parse("ok", false, app)?.playing()?, None);
            }
            for status in ["denied", "unavailable"] {
                assert_eq!(parse(status, true, "")?.playing()?, None);
            }
            assert!(parse("error", false, "")?.playing().is_err());
            assert!(parse("ok", true, "unknown")?.playing().is_err());
            assert!(serde_json::from_str::<Snapshot>("{\"status\":\"ok\"}").is_err());
            Ok(())
        }

        struct FakeSource(Option<Track>, bool);
        impl MediaSource for FakeSource {
            fn poll(&mut self) -> Result<Option<Track>, SensorError> {
                if self.1 {
                    Err(failed("fake failure"))
                } else {
                    Ok(self.0.clone())
                }
            }
        }

        #[test]
        fn permission_loss_stops_after_hold_and_regrant_restarts(
        ) -> Result<(), Box<dyn std::error::Error>> {
            let _lock = test_flag_lock();
            let (tx, rx) = std::sync::mpsc::channel();
            let track = parse("ok", true, "com.spotify.client")?.playing()?;
            let mut source = FakeSource(track.clone(), false);
            let mut tracker = MusicTracker::default();
            tick(&mut source, &mut tracker, &tx, 0)?;
            assert!(matches!(rx.try_recv(), Ok(FioreEvent::MusicStarted { .. })));
            source.0 = None;
            tick(&mut source, &mut tracker, &tx, 500)?;
            tick(&mut source, &mut tracker, &tx, 2499)?;
            assert!(rx.try_recv().is_err());
            tick(&mut source, &mut tracker, &tx, 2500)?;
            assert!(matches!(rx.try_recv(), Ok(FioreEvent::MusicStopped {})));
            assert!(!MUSIC_PLAYING.load(Ordering::Acquire));
            source.0 = track;
            tick(&mut source, &mut tracker, &tx, 3000)?;
            assert!(matches!(rx.try_recv(), Ok(FioreEvent::MusicStarted { .. })));
            Ok(())
        }

        #[test]
        fn fatal_source_failure_clears_audio_gate_and_headphones(
        ) -> Result<(), Box<dyn std::error::Error>> {
            let _lock = test_flag_lock();
            let (tx, rx) = std::sync::mpsc::channel();
            let mut source = FakeSource(parse("ok", true, "com.apple.Music")?.playing()?, false);
            let mut tracker = MusicTracker::default();
            tick(&mut source, &mut tracker, &tx, 0)?;
            rx.try_recv()?;
            source.1 = true;
            assert!(tick(&mut source, &mut tracker, &tx, 500).is_err());
            assert!(matches!(rx.try_recv(), Ok(FioreEvent::MusicStopped {})));
            assert!(!MUSIC_PLAYING.load(Ordering::Acquire));
            Ok(())
        }
    }
}

fn elapsed_ms(origin: Instant) -> u64 {
    u64::try_from(origin.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn failed(err: impl std::fmt::Display) -> SensorError {
    SensorError::Failed(err.to_string())
}

#[cfg(test)]
pub(super) fn test_flag_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    match LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(windows)]
mod gsmtc {
    use super::{
        elapsed_ms, failed, select_session, Track, BACKOFF_CAP_MS, BACKOFF_START_MS, POLL_MS,
    };
    use super::{MusicTracker, SessionChoice};
    use crate::sensors::win::WinRtGuard;
    use crate::sensors::SensorError;
    use std::sync::mpsc::Sender;
    use std::time::{Duration, Instant};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
        SessionsChangedEventArgs,
    };

    struct ListedSessions {
        flags: Vec<bool>,
        sessions: Vec<Session>,
    }

    struct SessionSubscription {
        manager: Manager,
        token: i64,
    }

    impl Drop for SessionSubscription {
        fn drop(&mut self) {
            if let Err(err) = self.manager.RemoveSessionsChanged(self.token) {
                tracing::debug!(sensor = "media", error = %err, "SessionsChanged remove failed");
            }
        }
    }

    pub(super) fn run(tx: Sender<crate::events::FioreEvent>) -> Result<(), SensorError> {
        // Guard is created on this thread and dropped last, after the manager.
        let _winrt = WinRtGuard::mta().map_err(failed)?;
        let manager = Manager::RequestAsync()
            .map_err(failed)?
            .join()
            .map_err(failed)?;
        let (signal_tx, signal_rx) = std::sync::mpsc::channel();
        let token = manager
            .SessionsChanged(
                &TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(
                    move |_sender, _args| {
                        // The handler runs on a thread-pool thread and only wakes the sensor loop.
                        let _ = signal_tx.send(());
                        Ok(())
                    },
                ),
            )
            .map_err(failed)?;
        let _subscription = SessionSubscription {
            manager: manager.clone(),
            token,
        };
        let mut tracker = MusicTracker::default();
        let mut delay_ms = BACKOFF_START_MS;
        let mut retry_at = Instant::now();
        let origin = Instant::now();
        loop {
            if Instant::now() >= retry_at {
                match poll_playing(&manager) {
                    Ok(playing) => {
                        delay_ms = BACKOFF_START_MS;
                        for event in tracker.sample(playing, elapsed_ms(origin)) {
                            if tx.send(event).is_err() {
                                return Ok(());
                            }
                        }
                    }
                    Err(err) => {
                        tracing::warn!(sensor = "media", error = %err, "session poll failed");
                        retry_at = Instant::now() + Duration::from_millis(delay_ms);
                        delay_ms = (delay_ms.saturating_mul(2)).min(BACKOFF_CAP_MS);
                    }
                }
            }
            let _ = signal_rx.recv_timeout(Duration::from_millis(POLL_MS));
        }
    }

    fn poll_playing(manager: &Manager) -> windows::core::Result<Option<Track>> {
        let current = current_session(manager)?;
        let current_playing = match &current {
            Some(session) => is_playing(session)?,
            None => false,
        };
        let others = other_sessions(manager)?;
        match select_session(current_playing, &others.flags) {
            SessionChoice::None => Ok(None),
            SessionChoice::Current => match &current {
                Some(session) => Ok(Some(read_track(session)?)),
                None => Ok(None),
            },
            SessionChoice::Index(index) => match others.sessions.get(index) {
                Some(session) => Ok(Some(read_track(session)?)),
                None => Ok(None),
            },
        }
    }

    fn current_session(manager: &Manager) -> windows::core::Result<Option<Session>> {
        match manager.GetCurrentSession() {
            Ok(session) => Ok(Some(session)),
            Err(err) if absent(&err) => Ok(None),
            Err(err) => Err(err),
        }
    }

    fn other_sessions(manager: &Manager) -> windows::core::Result<ListedSessions> {
        let list = match manager.GetSessions() {
            Ok(list) => list,
            Err(err) if absent(&err) => {
                return Ok(ListedSessions {
                    flags: Vec::new(),
                    sessions: Vec::new(),
                });
            }
            Err(err) => return Err(err),
        };
        let count = list.Size()?;
        let mut flags = Vec::new();
        let mut sessions = Vec::new();
        for index in 0..count {
            let session = list.GetAt(index)?;
            flags.push(is_playing(&session)?);
            sessions.push(session);
        }
        Ok(ListedSessions { flags, sessions })
    }

    fn is_playing(session: &Session) -> windows::core::Result<bool> {
        let info = match session.GetPlaybackInfo() {
            Ok(info) => info,
            Err(err) if absent(&err) => return Ok(false),
            Err(err) => return Err(err),
        };
        match info.PlaybackStatus() {
            Ok(status) => Ok(status == Status::Playing),
            Err(err) if absent(&err) => Ok(false),
            Err(err) => Err(err),
        }
    }

    /// `.join()` blocks this sensor thread until GSMTC returns. The hub does not wait on it.
    fn read_track(session: &Session) -> windows::core::Result<Track> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let source_app = match session.SourceAppUserModelId() {
            Ok(app) => app.to_string(),
            Err(err) if absent(&err) => String::new(),
            Err(err) => return Err(err),
        };
        Ok(Track {
            title: props.Title()?.to_string(),
            artist: props.Artist()?.to_string(),
            source_app,
        })
    }

    /// A null session is `Err` with an empty code. That is "nothing playing", not a failure.
    fn absent(err: &windows::core::Error) -> bool {
        err.code().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        select_session, test_flag_lock, MusicTracker, SessionChoice, Track, MUSIC_PLAYING,
    };
    use crate::events::FioreEvent;
    use std::sync::atomic::Ordering;

    fn track(title: &str, artist: &str) -> Track {
        Track {
            title: title.to_string(),
            artist: artist.to_string(),
            source_app: "app".to_string(),
        }
    }

    fn started(title: &str, artist: &str) -> FioreEvent {
        FioreEvent::MusicStarted {
            title: title.to_string(),
            artist: artist.to_string(),
            source_app: "app".to_string(),
        }
    }

    fn changed(title: &str, artist: &str) -> FioreEvent {
        FioreEvent::MusicTrackChanged {
            title: title.to_string(),
            artist: artist.to_string(),
        }
    }

    #[test]
    fn baseline_emits_started_or_stopped() {
        let _lock = test_flag_lock();
        let mut silent = MusicTracker::default();
        assert_eq!(silent.sample(None, 0), vec![FioreEvent::MusicStopped {}]);
        assert!(!MUSIC_PLAYING.load(Ordering::Acquire));
        assert!(silent.sample(None, 10).is_empty());

        let mut playing = MusicTracker::default();
        assert_eq!(
            playing.sample(Some(track("A", "a")), 0),
            vec![started("A", "a")]
        );
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
        assert!(playing.sample(Some(track("A", "a")), 10).is_empty());
    }

    #[test]
    fn track_changed_on_title_or_artist() {
        let _lock = test_flag_lock();
        let mut tracker = MusicTracker::default();
        assert_eq!(
            tracker.sample(Some(track("A", "a")), 0),
            vec![started("A", "a")]
        );
        assert_eq!(
            tracker.sample(Some(track("B", "a")), 10),
            vec![changed("B", "a")]
        );
        assert_eq!(
            tracker.sample(Some(track("B", "b")), 20),
            vec![changed("B", "b")]
        );
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
        assert!(tracker.sample(Some(track("B", "b")), 30).is_empty());
    }

    #[test]
    fn empty_title_is_ignored() {
        let _lock = test_flag_lock();
        let mut tracker = MusicTracker::default();
        tracker.sample(Some(track("A", "a")), 0);
        let mut blank = track("", "other");
        blank.source_app = "other-app".to_string();
        assert!(tracker.sample(Some(blank), 10).is_empty());
        assert_eq!(
            tracker.sample(Some(track("C", "c")), 20),
            vec![changed("C", "c")]
        );
    }

    #[test]
    fn ac_mu_5_pause_shorter_than_two_seconds_emits_nothing() {
        let _lock = test_flag_lock();
        let mut tracker = MusicTracker::default();
        tracker.sample(Some(track("A", "a")), 0);
        assert!(tracker.sample(None, 1_000).is_empty());
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
        assert!(tracker.sample(None, 2_999).is_empty());
        assert!(tracker.sample(Some(track("A", "a")), 2_999).is_empty());
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
        assert_eq!(
            tracker.sample(Some(track("B", "b")), 3_100),
            vec![changed("B", "b")]
        );
    }

    #[test]
    fn ac_mu_5_stop_at_two_seconds_clears_the_flag() {
        let _lock = test_flag_lock();
        let mut tracker = MusicTracker::default();
        tracker.sample(Some(track("A", "a")), 0);
        assert!(tracker.sample(None, 100).is_empty());
        assert!(tracker.sample(None, 2_099).is_empty());
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
        assert_eq!(
            tracker.sample(None, 2_100),
            vec![FioreEvent::MusicStopped {}]
        );
        assert!(!MUSIC_PLAYING.load(Ordering::Acquire));
        assert!(tracker.sample(None, 4_000).is_empty());
        assert_eq!(
            tracker.sample(Some(track("A", "a")), 5_000),
            vec![started("A", "a")]
        );
        assert!(MUSIC_PLAYING.load(Ordering::Acquire));
    }

    #[test]
    fn select_session_prefers_current_then_first_playing() {
        assert_eq!(select_session(true, &[false, true]), SessionChoice::Current);
        assert_eq!(
            select_session(false, &[false, true, true]),
            SessionChoice::Index(1)
        );
        assert_eq!(select_session(false, &[false, false]), SessionChoice::None);
        assert_eq!(select_session(false, &[]), SessionChoice::None);
    }
}
