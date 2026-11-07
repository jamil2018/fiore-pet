use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use chrono::Datelike;
use chrono::Duration as ChronoDuration;
use chrono::Local;
use chrono::NaiveDateTime;
use chrono::Timelike;

use crate::events::FioreEvent;
use crate::events::Mood;
use crate::events::Season;
use crate::sensors::Sensor;
use crate::sensors::SensorError;

const MINUTE_NS: u64 = 60 * 1_000_000_000;
const DAY_NS: u64 = 24 * 60 * MINUTE_NS;
const MAX_SLEEP: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hemisphere {
    North,
    South,
}

impl Hemisphere {
    fn from_value(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some(text) if text.eq_ignore_ascii_case("south") => Hemisphere::South,
            _ => Hemisphere::North,
        }
    }

    fn from_env() -> Self {
        Self::from_value(std::env::var("FIORE_HEMISPHERE").ok().as_deref())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CivilTime {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    nanosecond: u32,
}

trait Clock {
    fn now(&self) -> CivilTime;
}

struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> CivilTime {
        civil_naive(Local::now().naive_local())
    }
}

struct FakeClock {
    origin: NaiveDateTime,
    started: Instant,
}

impl FakeClock {
    fn parse(stamp: &str) -> Option<Self> {
        let origin = parse_stamp(stamp)?;
        Some(Self {
            origin,
            started: Instant::now(),
        })
    }

    fn at_elapsed(&self, elapsed: Duration) -> CivilTime {
        civil_naive(advance(self.origin, elapsed).unwrap_or(self.origin))
    }
}

impl Clock for FakeClock {
    fn now(&self) -> CivilTime {
        self.at_elapsed(self.started.elapsed())
    }
}

enum ClockChoice {
    System,
    Fake(FakeClock),
    Invalid(String),
}

enum ActiveClock {
    System(SystemClock),
    Fake(FakeClock),
}

impl Clock for ActiveClock {
    fn now(&self) -> CivilTime {
        match self {
            ActiveClock::System(clock) => clock.now(),
            ActiveClock::Fake(clock) => clock.now(),
        }
    }
}

pub struct ClockSensor;

impl Sensor for ClockSensor {
    fn name(&self) -> &'static str {
        "clock"
    }

    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        let hemisphere = Hemisphere::from_env();
        let clock = active_clock();
        tracing::debug!(sensor = "clock", hemisphere = ?hemisphere, "clock started");
        run_clock(&clock, hemisphere, &tx);
        Ok(())
    }
}

fn mood_for(hour: u32, minute: u32) -> Mood {
    let minutes = hour.saturating_mul(60).saturating_add(minute);
    if (5 * 60..11 * 60).contains(&minutes) {
        Mood::Energetic
    } else if (11 * 60..17 * 60).contains(&minutes) {
        Mood::Content
    } else if (17 * 60..21 * 60).contains(&minutes) {
        Mood::Calm
    } else {
        Mood::Sleepy
    }
}

fn season_for(month: u32, hemisphere: Hemisphere) -> Season {
    let north = match month {
        12 | 1 | 2 => Season::Winter,
        3..=5 => Season::Spring,
        6..=8 => Season::Summer,
        _ => Season::Autumn,
    };
    match hemisphere {
        Hemisphere::North => north,
        Hemisphere::South => opposite(north),
    }
}

fn opposite(season: Season) -> Season {
    match season {
        Season::Winter => Season::Summer,
        Season::Summer => Season::Winter,
        Season::Spring => Season::Autumn,
        Season::Autumn => Season::Spring,
    }
}

fn parse_stamp(stamp: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(stamp, "%Y-%m-%dT%H:%M:%S").ok()
}

fn advance(origin: NaiveDateTime, elapsed: Duration) -> Option<NaiveDateTime> {
    let delta = ChronoDuration::from_std(elapsed).ok()?;
    origin.checked_add_signed(delta)
}

fn choose_clock(raw: Option<&str>) -> ClockChoice {
    match raw {
        None => ClockChoice::System,
        Some(value) => {
            let stamp = value.trim();
            if stamp.is_empty() {
                ClockChoice::Invalid(value.to_string())
            } else {
                match FakeClock::parse(stamp) {
                    Some(clock) => ClockChoice::Fake(clock),
                    None => ClockChoice::Invalid(stamp.to_string()),
                }
            }
        }
    }
}

fn active_clock() -> ActiveClock {
    match choose_clock(std::env::var("FIORE_FAKE_CLOCK").ok().as_deref()) {
        ClockChoice::Fake(clock) => {
            tracing::debug!(
                sensor = "clock",
                stamp = %clock.origin.format("%Y-%m-%dT%H:%M:%S"),
                "using fake clock"
            );
            ActiveClock::Fake(clock)
        }
        ClockChoice::Invalid(stamp) => {
            tracing::warn!(
                sensor = "clock",
                stamp = %stamp,
                "invalid FIORE_FAKE_CLOCK; using system clock"
            );
            ActiveClock::System(SystemClock)
        }
        ClockChoice::System => ActiveClock::System(SystemClock),
    }
}

fn civil_naive(time: NaiveDateTime) -> CivilTime {
    CivilTime {
        year: time.year(),
        month: time.month(),
        day: time.day(),
        hour: time.hour(),
        minute: time.minute(),
        second: time.second(),
        nanosecond: time.nanosecond(),
    }
}

fn sample(now: &CivilTime, hemisphere: Hemisphere) -> (Mood, Season) {
    (
        mood_for(now.hour, now.minute),
        season_for(now.month, hemisphere),
    )
}

fn transitions(previous: Option<(Mood, Season)>, current: (Mood, Season)) -> Vec<FioreEvent> {
    let (mood, season) = current;
    match previous {
        None => vec![mood_event(mood), season_event(season)],
        Some((prev_mood, prev_season)) => {
            let mut events = Vec::new();
            if prev_mood != mood {
                events.push(mood_event(mood));
            }
            if prev_season != season {
                events.push(season_event(season));
            }
            events
        }
    }
}

fn mood_event(mood: Mood) -> FioreEvent {
    FioreEvent::TimeMoodChanged { mood }
}

fn season_event(season: Season) -> FioreEvent {
    FioreEvent::SeasonChanged { season }
}

struct Tick {
    events: Vec<FioreEvent>,
    sleep: Duration,
    current: (Mood, Season),
}

fn plan_tick(previous: Option<(Mood, Season)>, now: &CivilTime, hemisphere: Hemisphere) -> Tick {
    let current = sample(now, hemisphere);
    Tick {
        events: transitions(previous, current),
        sleep: next_wake(now),
        current,
    }
}

/// Earlier of the next minute and the next midnight, never longer than 60s.
/// A zero sleep would spin the sensor thread, so an unusable stamp waits a full minute.
fn next_wake(now: &CivilTime) -> Duration {
    let Some(minute) = until_next_minute(now) else {
        return MAX_SLEEP;
    };
    let Some(midnight) = until_next_midnight(now) else {
        return MAX_SLEEP;
    };
    let wake = minute.min(midnight).min(MAX_SLEEP);
    if wake.is_zero() {
        MAX_SLEEP
    } else {
        wake
    }
}

fn until_next_minute(now: &CivilTime) -> Option<Duration> {
    if now.second > 59 || now.nanosecond >= 1_000_000_000 {
        return None;
    }
    let into = u64::from(now.second) * 1_000_000_000 + u64::from(now.nanosecond);
    let left = if into == 0 {
        MINUTE_NS
    } else {
        MINUTE_NS - into
    };
    Some(Duration::from_nanos(left))
}

fn until_next_midnight(now: &CivilTime) -> Option<Duration> {
    if now.hour > 23 || now.minute > 59 || now.second > 59 || now.nanosecond >= 1_000_000_000 {
        return None;
    }
    let since = u64::from(now.hour) * 3_600 * 1_000_000_000
        + u64::from(now.minute) * MINUTE_NS
        + u64::from(now.second) * 1_000_000_000
        + u64::from(now.nanosecond);
    if since >= DAY_NS {
        return None;
    }
    let left = if since == 0 { DAY_NS } else { DAY_NS - since };
    Some(Duration::from_nanos(left))
}

fn keep_running() -> bool {
    false
}

fn run_clock(clock: &impl Clock, hemisphere: Hemisphere, tx: &Sender<FioreEvent>) {
    run_until(clock, hemisphere, tx, keep_running);
}

fn run_until(
    clock: &impl Clock,
    hemisphere: Hemisphere,
    tx: &Sender<FioreEvent>,
    stop: impl Fn() -> bool,
) {
    let mut previous = None;
    loop {
        if stop() {
            return;
        }
        let now = clock.now();
        let tick = plan_tick(previous, &now, hemisphere);
        for event in tick.events {
            if tx.send(event).is_err() {
                tracing::debug!(sensor = "clock", "hub closed; clock stopped");
                return;
            }
        }
        previous = Some(tick.current);
        thread::park_timeout(tick.sleep);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::cell::Cell;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use super::*;

    fn at(hour: u32, minute: u32, second: u32, nanosecond: u32) -> CivilTime {
        CivilTime {
            year: 2026,
            month: 6,
            day: 15,
            hour,
            minute,
            second,
            nanosecond,
        }
    }

    #[test]
    fn ac_ms_1_mood_boundaries() {
        let cases = [
            (4, 59, Mood::Sleepy),
            (5, 0, Mood::Energetic),
            (10, 59, Mood::Energetic),
            (11, 0, Mood::Content),
            (16, 59, Mood::Content),
            (17, 0, Mood::Calm),
            (20, 59, Mood::Calm),
            (21, 0, Mood::Sleepy),
            (0, 0, Mood::Sleepy),
            (23, 59, Mood::Sleepy),
        ];
        for (hour, minute, mood) in cases {
            assert_eq!(mood_for(hour, minute), mood, "{hour:02}:{minute:02}");
        }
    }

    #[test]
    fn ac_ms_2_season_boundaries_and_south_flip() {
        let cases = [
            ("2026-11-30T12:00:00", Season::Autumn),
            ("2026-12-01T12:00:00", Season::Winter),
            ("2026-02-28T12:00:00", Season::Winter),
            ("2028-02-29T12:00:00", Season::Winter),
            ("2026-03-01T12:00:00", Season::Spring),
            ("2026-08-31T12:00:00", Season::Summer),
            ("2026-09-01T12:00:00", Season::Autumn),
        ];
        for (stamp, north) in cases {
            let time = parse_stamp(stamp).unwrap_or_else(|| panic!("parse {stamp}"));
            assert_eq!(
                season_for(time.month(), Hemisphere::North),
                north,
                "{stamp}"
            );
            assert_eq!(
                season_for(time.month(), Hemisphere::South),
                opposite(north),
                "{stamp} south"
            );
        }
        assert!(parse_stamp("2026-02-29T12:00:00").is_none());
    }

    #[test]
    fn hemisphere_flag_accepts_only_south() {
        assert_eq!(Hemisphere::from_value(None), Hemisphere::North);
        assert_eq!(Hemisphere::from_value(Some("north")), Hemisphere::North);
        assert_eq!(Hemisphere::from_value(Some("no")), Hemisphere::North);
        assert_eq!(Hemisphere::from_value(Some("")), Hemisphere::North);
        assert_eq!(Hemisphere::from_value(Some("south")), Hemisphere::South);
        assert_eq!(Hemisphere::from_value(Some("SOUTH")), Hemisphere::South);
        assert_eq!(Hemisphere::from_value(Some(" south ")), Hemisphere::South);
    }

    #[test]
    fn fake_clock_parses_advances_and_rejects_invalid_stamps() {
        assert!(matches!(choose_clock(None), ClockChoice::System));
        assert!(matches!(
            choose_clock(Some("nope")),
            ClockChoice::Invalid(_)
        ));
        assert!(matches!(
            choose_clock(Some("2026-06-15T04:59:00Z")),
            ClockChoice::Invalid(_)
        ));
        assert!(matches!(choose_clock(Some("   ")), ClockChoice::Invalid(_)));
        assert!(matches!(
            choose_clock(Some("2026-13-01T00:00:00")),
            ClockChoice::Invalid(_)
        ));

        let ClockChoice::Fake(clock) = choose_clock(Some("  2026-06-15T10:59:30  ")) else {
            panic!("expected fake clock");
        };
        let advanced = clock.at_elapsed(Duration::from_secs(40));
        assert_eq!(
            (advanced.hour, advanced.minute, advanced.second),
            (11, 0, 10)
        );
        assert_eq!(mood_for(advanced.hour, advanced.minute), Mood::Content);
        assert_eq!(mood_for(10, 59), Mood::Energetic);

        let eve = parse_stamp("2026-11-30T23:59:30").unwrap();
        let new_year_day = advance(eve, Duration::from_secs(40)).unwrap();
        assert_eq!(
            (
                new_year_day.month(),
                new_year_day.day(),
                new_year_day.hour()
            ),
            (12, 1, 0)
        );
        assert_eq!(
            season_for(new_year_day.month(), Hemisphere::North),
            Season::Winter
        );

        let leap_eve = parse_stamp("2028-02-28T23:59:00").unwrap();
        let leap_day = advance(leap_eve, Duration::from_secs(120)).unwrap();
        assert_eq!((leap_day.month(), leap_day.day()), (2, 29));
        assert_eq!(
            season_for(leap_day.month(), Hemisphere::North),
            Season::Winter
        );
    }

    #[test]
    fn emits_baseline_then_only_changes() {
        let june_evening = at(18, 0, 0, 0);
        let baseline = plan_tick(None, &june_evening, Hemisphere::North);
        assert_eq!(
            baseline.events,
            vec![
                FioreEvent::TimeMoodChanged { mood: Mood::Calm },
                FioreEvent::SeasonChanged {
                    season: Season::Summer
                },
            ]
        );

        let still = plan_tick(Some(baseline.current), &june_evening, Hemisphere::North);
        assert!(still.events.is_empty());

        let sleepy = at(21, 0, 0, 0);
        let mood_only = plan_tick(Some(baseline.current), &sleepy, Hemisphere::North);
        assert_eq!(
            mood_only.events,
            vec![FioreEvent::TimeMoodChanged { mood: Mood::Sleepy }]
        );

        let december = CivilTime {
            month: 12,
            day: 1,
            ..june_evening
        };
        let season_only = plan_tick(Some(baseline.current), &december, Hemisphere::North);
        assert_eq!(
            season_only.events,
            vec![FioreEvent::SeasonChanged {
                season: Season::Winter,
            }]
        );

        let night = CivilTime {
            hour: 21,
            minute: 0,
            ..june_evening
        };
        let both = plan_tick(Some(baseline.current), &night, Hemisphere::South);
        assert_eq!(
            both.events,
            vec![
                FioreEvent::TimeMoodChanged { mood: Mood::Sleepy },
                FioreEvent::SeasonChanged {
                    season: Season::Winter,
                },
            ]
        );
    }

    #[test]
    fn next_wake_hits_the_minute_or_midnight_within_60s() {
        assert_eq!(next_wake(&at(10, 15, 40, 0)), Duration::from_secs(20));
        assert_eq!(next_wake(&at(10, 15, 0, 0)), Duration::from_secs(60));
        assert_eq!(next_wake(&at(23, 59, 50, 0)), Duration::from_secs(10));
        assert_eq!(next_wake(&at(23, 59, 30, 0)), Duration::from_secs(30));
        assert_eq!(next_wake(&at(12, 0, 0, 0)), Duration::from_secs(60));
        assert_eq!(next_wake(&at(0, 0, 0, 0)), Duration::from_secs(60));
        assert_eq!(
            next_wake(&at(23, 59, 59, 500_000_000)),
            Duration::from_millis(500)
        );
        assert_eq!(
            next_wake(&at(10, 15, 0, 100_000_000)),
            Duration::new(59, 900_000_000)
        );
        assert_eq!(next_wake(&at(99, 0, 0, 0)), Duration::from_secs(60));

        for second in 0..60 {
            for nanos in [0, 1, 999_999_999] {
                assert!(!next_wake(&at(10, 0, second, nanos)).is_zero());
            }
        }
    }

    struct ScriptClock {
        times: Vec<CivilTime>,
        index: Cell<usize>,
    }

    impl ScriptClock {
        fn new(times: Vec<CivilTime>) -> Self {
            Self {
                times,
                index: Cell::new(0),
            }
        }
    }

    impl Clock for ScriptClock {
        fn now(&self) -> CivilTime {
            let index = self.index.get();
            let time = self
                .times
                .get(index)
                .copied()
                .unwrap_or_else(|| self.times.last().copied().expect("script times"));
            if index < self.times.len() {
                self.index.set(index + 1);
            }
            time
        }
    }

    #[test]
    fn sensor_loop_emits_baseline_then_only_changes() {
        let almost = |hour: u32, minute: u32| at(hour, minute, 59, 995_000_000);
        let energetic = almost(10, 59);
        let content = almost(11, 0);
        assert!(next_wake(&energetic) <= Duration::from_millis(5));
        let clock = ScriptClock::new(vec![energetic, energetic, content]);
        let (tx, rx) = std::sync::mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            run_until(&clock, Hemisphere::North, &tx, || {
                stop_flag.load(Ordering::Relaxed)
            });
        });

        let first = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let second = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let third = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            first,
            FioreEvent::TimeMoodChanged {
                mood: Mood::Energetic
            }
        );
        assert_eq!(
            second,
            FioreEvent::SeasonChanged {
                season: Season::Summer
            }
        );
        assert_eq!(
            third,
            FioreEvent::TimeMoodChanged {
                mood: Mood::Content
            }
        );
        stop.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    #[test]
    fn system_clock_reports_a_civil_time() {
        let now = SystemClock.now();
        assert!((1..=12).contains(&now.month));
        assert!(now.hour < 24);
        assert!(now.minute < 60);
    }
}
