//! Endpoint peak meter: `music.level` while `MUSIC_PLAYING` is set.

use std::sync::atomic::Ordering;
use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::media::MUSIC_PLAYING;
use crate::sensors::{Sensor, SensorError};

const IDLE_MS: u64 = 250;
const TICK_MS: u64 = 66;
const BACKOFF_START_MS: u64 = 1_000;
const BACKOFF_CAP_MS: u64 = 30_000;

pub trait PeakSource {
    fn enabled(&self) -> bool {
        true
    }
    fn open(&mut self) -> bool;
    fn peak(&mut self) -> Option<f32>;
    fn close(&mut self);
}

#[derive(Debug)]
pub struct PeakLoop {
    open: bool,
    backoff_ms: u64,
    retry_at: u64,
}

impl Default for PeakLoop {
    fn default() -> Self {
        Self {
            open: false,
            backoff_ms: BACKOFF_START_MS,
            retry_at: 0,
        }
    }
}

impl PeakLoop {
    /// One loop step. While the playing flag is clear, the source is not opened or read.
    pub fn step(&mut self, now_ms: u64, source: &mut dyn PeakSource) -> (Vec<FioreEvent>, u64) {
        if !MUSIC_PLAYING.load(Ordering::Acquire) || !source.enabled() {
            self.drop_meter(source);
            self.backoff_ms = BACKOFF_START_MS;
            self.retry_at = 0;
            return (Vec::new(), IDLE_MS);
        }
        if !self.open {
            return self.try_open(now_ms, source);
        }
        self.read(now_ms, source)
    }

    fn drop_meter(&mut self, source: &mut dyn PeakSource) {
        if self.open {
            source.close();
            self.open = false;
        }
    }

    fn try_open(&mut self, now_ms: u64, source: &mut dyn PeakSource) -> (Vec<FioreEvent>, u64) {
        if now_ms < self.retry_at {
            return (Vec::new(), capped_wait(self.retry_at - now_ms));
        }
        if source.open() {
            self.open = true;
            self.backoff_ms = BACKOFF_START_MS;
            return self.read(now_ms, source);
        }
        let wait = self.schedule_retry(now_ms);
        (Vec::new(), capped_wait(wait))
    }

    fn read(&mut self, now_ms: u64, source: &mut dyn PeakSource) -> (Vec<FioreEvent>, u64) {
        match source.peak() {
            Some(value) => (
                vec![FioreEvent::MusicLevel {
                    peak: clamp_unit(value),
                }],
                TICK_MS,
            ),
            None => {
                source.close();
                self.open = false;
                let wait = self.schedule_retry(now_ms);
                (Vec::new(), capped_wait(wait))
            }
        }
    }

    fn schedule_retry(&mut self, now_ms: u64) -> u64 {
        let wait = self.backoff_ms;
        self.retry_at = now_ms.saturating_add(wait);
        self.backoff_ms = wait.saturating_mul(2).min(BACKOFF_CAP_MS);
        wait
    }
}

fn capped_wait(ms: u64) -> u64 {
    ms.clamp(1, IDLE_MS)
}

fn clamp_unit(value: f32) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    f64::from(value).clamp(0.0, 1.0)
}

pub struct AudioPeakSensor;

impl Sensor for AudioPeakSensor {
    fn name(&self) -> &'static str {
        "audio_peak"
    }

    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        #[cfg(windows)]
        {
            device::run(tx)
        }
        #[cfg(target_os = "macos")]
        {
            mac_device::run(tx)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = tx;
            tracing::debug!(sensor = "audio_peak", "unsupported platform");
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_device {
    use super::{PeakLoop, PeakSource};
    use crate::events::FioreEvent;
    use crate::sensors::SensorError;
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::mpsc::Sender;
    use std::time::{Duration, Instant};

    extern "C" {
        fn fiore_macos_audio_supported() -> i32;
        fn fiore_macos_audio_enabled() -> i32;
        fn fiore_macos_peak_open() -> *mut c_void;
        fn fiore_macos_peak_read(handle: *mut c_void, peak: *mut f32) -> i32;
        fn fiore_macos_peak_close(handle: *mut c_void);
    }

    struct MacMeter {
        handle: Option<NonNull<c_void>>,
        failure_reported: bool,
    }

    impl PeakSource for MacMeter {
        fn enabled(&self) -> bool {
            // SAFETY: this bridge function has no pointer arguments and synchronizes its setting.
            unsafe { fiore_macos_audio_enabled() != 0 }
        }

        fn open(&mut self) -> bool {
            // SAFETY: called only on this sensor's worker; the bridge returns an owned opaque handle.
            self.handle = NonNull::new(unsafe { fiore_macos_peak_open() });
            if self.handle.is_none() && !self.failure_reported {
                tracing::warn!(sensor = "audio_peak", "Mac output meter unavailable; check audio permission and re-enable audio reactions");
                self.failure_reported = true;
            }
            self.handle.is_some()
        }

        fn peak(&mut self) -> Option<f32> {
            let handle = self.handle?;
            let mut peak = 0.0;
            // SAFETY: handle is live and owned by this worker; peak points to writable f32 storage.
            match unsafe { fiore_macos_peak_read(handle.as_ptr(), &mut peak) } {
                0 => {
                    self.failure_reported = false;
                    Some(peak)
                }
                1 => Some(0.0), // No new callback: never replay the preceding amplitude.
                _ => {
                    if !self.failure_reported {
                        tracing::warn!(sensor = "audio_peak", "Mac output meter interrupted");
                        self.failure_reported = true;
                    }
                    None
                }
            }
        }

        fn close(&mut self) {
            if let Some(handle) = self.handle.take() {
                // SAFETY: take transfers the single owned live handle; native close drains callbacks.
                unsafe { fiore_macos_peak_close(handle.as_ptr()) };
            }
        }
    }

    impl Drop for MacMeter {
        fn drop(&mut self) {
            self.close();
        }
    }

    pub(super) fn run(tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        // SAFETY: the availability query has no arguments or ownership requirements.
        if unsafe { fiore_macos_audio_supported() } == 0 {
            return Err(SensorError::Failed(
                "audio reactions require macOS 14.2 or newer".into(),
            ));
        }
        let mut meter = MacMeter {
            handle: None,
            failure_reported: false,
        };
        let mut sampler = PeakLoop::default();
        let origin = Instant::now();
        loop {
            let now = u64::try_from(origin.elapsed().as_millis()).unwrap_or(u64::MAX);
            let (events, sleep_ms) = sampler.step(now, &mut meter);
            for event in events {
                if tx.send(event).is_err() {
                    return Ok(());
                }
            }
            std::thread::park_timeout(Duration::from_millis(sleep_ms));
        }
    }
}

#[cfg(windows)]
mod device {
    use super::{PeakLoop, PeakSource};
    use crate::events::FioreEvent;
    use crate::sensors::win::ComGuard;
    use crate::sensors::SensorError;
    use std::sync::mpsc::Sender;
    use std::thread;
    use std::time::{Duration, Instant};
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    struct Meter(IAudioMeterInformation);

    impl Meter {
        fn open_default() -> windows::core::Result<Self> {
            // SAFETY: CoCreateInstance, GetDefaultAudioEndpoint, and Activate run on this
            // sensor thread after ComGuard::mta. IAudioMeterInformation requires a null
            // activation parameter, which `None` supplies.
            unsafe {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let endpoint = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
                let meter = endpoint.Activate(CLSCTX_ALL, None)?;
                Ok(Self(meter))
            }
        }

        fn peak(&self) -> windows::core::Result<f32> {
            // SAFETY: the meter was activated on this thread and is still held here.
            unsafe { self.0.GetPeakValue() }
        }
    }

    struct WindowsMeter {
        inner: Option<Meter>,
    }

    impl PeakSource for WindowsMeter {
        fn open(&mut self) -> bool {
            match Meter::open_default() {
                Ok(meter) => {
                    self.inner = Some(meter);
                    true
                }
                Err(err) => {
                    tracing::warn!(sensor = "audio_peak", error = %err, "meter open failed");
                    false
                }
            }
        }

        fn peak(&mut self) -> Option<f32> {
            let meter = self.inner.as_ref()?;
            match meter.peak() {
                Ok(value) => Some(value),
                Err(err) => {
                    tracing::warn!(sensor = "audio_peak", error = %err, "meter read failed");
                    None
                }
            }
        }

        fn close(&mut self) {
            self.inner = None;
        }
    }

    pub(super) fn run(tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        // Declared first so COM uninitializes after the meter is dropped.
        let _com = ComGuard::mta().map_err(|err| SensorError::Failed(err.to_string()))?;
        let mut meter = WindowsMeter { inner: None };
        let mut sampler = PeakLoop::default();
        let origin = Instant::now();
        loop {
            let now = u64::try_from(origin.elapsed().as_millis()).unwrap_or(u64::MAX);
            let (events, sleep_ms) = sampler.step(now, &mut meter);
            for event in events {
                if tx.send(event).is_err() {
                    return Ok(());
                }
            }
            thread::park_timeout(Duration::from_millis(sleep_ms));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PeakLoop, PeakSource, IDLE_MS, TICK_MS};
    use crate::events::FioreEvent;
    use crate::sensors::media::{test_flag_lock, MUSIC_PLAYING};
    use std::sync::atomic::Ordering;

    struct Mock {
        open_ok: bool,
        peak: Option<f32>,
        opens: u32,
        peaks: u32,
        closes: u32,
    }

    impl PeakSource for Mock {
        fn open(&mut self) -> bool {
            self.opens += 1;
            self.open_ok
        }

        fn peak(&mut self) -> Option<f32> {
            self.peaks += 1;
            self.peak
        }

        fn close(&mut self) {
            self.closes += 1;
        }
    }

    struct PermissionGate {
        enabled: bool,
        source: Mock,
    }

    impl PeakSource for PermissionGate {
        fn enabled(&self) -> bool {
            self.enabled
        }
        fn open(&mut self) -> bool {
            self.source.open()
        }
        fn peak(&mut self) -> Option<f32> {
            self.source.peak()
        }
        fn close(&mut self) {
            self.source.close();
        }
    }

    #[test]
    fn opt_in_gates_open_and_revocation_closes_live_meter() {
        let _lock = test_flag_lock();
        MUSIC_PLAYING.store(true, Ordering::Release);
        let mut sampler = PeakLoop::default();
        let mut source = PermissionGate {
            enabled: false,
            source: Mock {
                open_ok: true,
                peak: Some(0.5),
                opens: 0,
                peaks: 0,
                closes: 0,
            },
        };
        assert!(sampler.step(0, &mut source).0.is_empty());
        assert_eq!(source.source.opens, 0);
        source.enabled = true;
        assert_eq!(
            sampler.step(250, &mut source).0,
            vec![FioreEvent::MusicLevel { peak: 0.5 }]
        );
        source.enabled = false;
        assert!(sampler.step(316, &mut source).0.is_empty());
        assert_eq!(source.source.closes, 1);
        assert_eq!(source.source.peaks, 1);
        source.enabled = true;
        assert_eq!(
            sampler.step(566, &mut source).0,
            vec![FioreEvent::MusicLevel { peak: 0.5 }]
        );
        assert_eq!(source.source.opens, 2);
        MUSIC_PLAYING.store(false, Ordering::Release);
    }

    #[test]
    fn infinities_cannot_drive_animation_amplitude() {
        assert_eq!(super::clamp_unit(f32::INFINITY), 0.0);
        assert_eq!(super::clamp_unit(f32::NEG_INFINITY), 0.0);
        assert_eq!(super::clamp_unit(f32::NAN), 0.0);
    }

    #[test]
    fn ac_mu_6_no_level_while_flag_is_false() {
        let _lock = test_flag_lock();
        MUSIC_PLAYING.store(false, Ordering::Release);
        let mut sampler = PeakLoop::default();
        let mut source = Mock {
            open_ok: true,
            peak: Some(1.0),
            opens: 0,
            peaks: 0,
            closes: 0,
        };
        let (events, sleep_ms) = sampler.step(0, &mut source);
        assert!(events.is_empty());
        assert_eq!(sleep_ms, IDLE_MS);
        assert_eq!(source.opens, 0);
        assert_eq!(source.peaks, 0);
        assert_eq!(source.closes, 0);
        let (again, _) = sampler.step(250, &mut source);
        assert!(again.is_empty());
        assert_eq!(source.opens, 0);
        assert_eq!(source.peaks, 0);
    }

    #[test]
    fn clamp_and_idle_after_stop() {
        let _lock = test_flag_lock();
        MUSIC_PLAYING.store(true, Ordering::Release);
        let mut sampler = PeakLoop::default();
        let mut source = Mock {
            open_ok: true,
            peak: Some(-0.4),
            opens: 0,
            peaks: 0,
            closes: 0,
        };
        let (low, sleep_ms) = sampler.step(0, &mut source);
        assert_eq!(low, vec![FioreEvent::MusicLevel { peak: 0.0 }]);
        assert_eq!(sleep_ms, TICK_MS);
        source.peak = Some(1.7);
        let (high, _) = sampler.step(66, &mut source);
        assert_eq!(high, vec![FioreEvent::MusicLevel { peak: 1.0 }]);
        source.peak = Some(f32::NAN);
        let (nan, _) = sampler.step(132, &mut source);
        assert_eq!(nan, vec![FioreEvent::MusicLevel { peak: 0.0 }]);
        source.peak = Some(0.25);
        let (mid, _) = sampler.step(198, &mut source);
        assert_eq!(mid, vec![FioreEvent::MusicLevel { peak: 0.25 }]);
        assert_eq!(source.opens, 1);
        MUSIC_PLAYING.store(false, Ordering::Release);
        let peaks_before = source.peaks;
        let (idle, sleep_ms) = sampler.step(250, &mut source);
        assert!(idle.is_empty());
        assert_eq!(sleep_ms, IDLE_MS);
        assert_eq!(source.closes, 1);
        assert_eq!(source.peaks, peaks_before);
    }

    #[test]
    fn backoff_doubles_from_one_second_to_thirty() {
        let _lock = test_flag_lock();
        MUSIC_PLAYING.store(true, Ordering::Release);
        let mut sampler = PeakLoop::default();
        let mut source = Mock {
            open_ok: false,
            peak: Some(1.0),
            opens: 0,
            peaks: 0,
            closes: 0,
        };
        let mut now = 0u64;
        for (index, gap) in [1_000u64, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
            .into_iter()
            .enumerate()
        {
            let (events, _) = sampler.step(now, &mut source);
            assert!(events.is_empty());
            let expected = u32::try_from(index).unwrap_or(0) + 1;
            assert_eq!(source.opens, expected);
            assert_eq!(source.peaks, 0);
            let (early, _) = sampler.step(now + gap - 1, &mut source);
            assert!(early.is_empty());
            assert_eq!(source.opens, expected);
            now += gap;
        }
        let (events, _) = sampler.step(now, &mut source);
        assert!(events.is_empty());
        assert_eq!(source.opens, 8);
        assert_eq!(source.peaks, 0);
    }

    #[test]
    fn peak_error_drops_meter_and_backs_off() {
        let _lock = test_flag_lock();
        MUSIC_PLAYING.store(true, Ordering::Release);
        let mut sampler = PeakLoop::default();
        let mut source = Mock {
            open_ok: true,
            peak: None,
            opens: 0,
            peaks: 0,
            closes: 0,
        };
        let (events, _) = sampler.step(0, &mut source);
        assert!(events.is_empty());
        assert_eq!(source.opens, 1);
        assert_eq!(source.peaks, 1);
        assert_eq!(source.closes, 1);
        let (retry_early, _) = sampler.step(999, &mut source);
        assert!(retry_early.is_empty());
        assert_eq!(source.opens, 1);
        source.peak = Some(0.5);
        let (events, _) = sampler.step(1_000, &mut source);
        assert_eq!(events, vec![FioreEvent::MusicLevel { peak: 0.5 }]);
        assert_eq!(source.opens, 2);
        assert_eq!(source.closes, 1);
    }
}
