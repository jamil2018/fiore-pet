//! Fullscreen sensor. A blocking shell state, or a foreground window that covers its
//! monitor, emits `fullscreen.entered` / `fullscreen.exited`. Desktop, shell, and this
//! process never count through the rect check.

use std::thread;
use std::time::Duration;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

#[cfg(windows)]
use super::win::{self, ComGuard};
#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(windows)]
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_ACCEPTS_NOTIFICATIONS,
    QUNS_APP, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_QUIET_TIME,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// The seven `QUNS_*` values. Only three of them block notifications.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellState {
    NotPresent,
    Busy,
    RunningD3dFullScreen,
    PresentationMode,
    AcceptsNotifications,
    QuietTime,
    App,
}

/// `SHQueryUserNotificationState` failed. The previous fullscreen bit stays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellMiss;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowSample {
    pub class: String,
    pub pid: u32,
    pub window: Rect,
    pub monitor: Rect,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sample {
    pub shell: Result<ShellState, ShellMiss>,
    pub window: Option<WindowSample>,
}

/// One sample of the shell and the current foreground window. Handles are not cached.
pub trait FullscreenSource {
    fn sample(&self) -> Sample;
}

/// Remembers the last fullscreen bit and emits only when it changes, including the baseline.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Edge {
    known: Option<bool>,
}

impl Edge {
    pub const fn new() -> Self {
        Self { known: None }
    }

    pub fn observe(&mut self, fullscreen: Option<bool>) -> Option<FioreEvent> {
        let next = fullscreen?;
        if self.known == Some(next) {
            return None;
        }
        self.known = Some(next);
        Some(if next {
            FioreEvent::FullscreenEntered {}
        } else {
            FioreEvent::FullscreenExited {}
        })
    }
}

pub fn shell_blocks(state: ShellState) -> bool {
    matches!(
        state,
        ShellState::Busy | ShellState::RunningD3dFullScreen | ShellState::PresentationMode
    )
}

/// Containment against `rcMonitor`, including equal edges. Invisible borders make a
/// covering window larger than the monitor, so equality alone would miss it.
pub fn covers(window: Rect, monitor: Rect) -> bool {
    window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom
}

pub fn excluded(class: &str, pid: u32, own: u32) -> bool {
    pid == own || matches!(class, "Progman" | "WorkerW" | "Shell_TrayWnd")
}

/// Shell block wins on its own. Exclusion applies only to the rect check, so presentation
/// mode still hides the pet while the desktop window is in front.
pub fn decide(shell: ShellState, window: Option<&WindowSample>, own_pid: u32) -> bool {
    if shell_blocks(shell) {
        return true;
    }
    let Some(window) = window else {
        return false;
    };
    if excluded(&window.class, window.pid, own_pid) {
        return false;
    }
    covers(window.window, window.monitor)
}

pub fn step(
    edge: &mut Edge,
    shell: Result<ShellState, ShellMiss>,
    window: Option<&WindowSample>,
    own_pid: u32,
) -> Option<FioreEvent> {
    let fullscreen = match shell {
        Ok(state) => Some(decide(state, window, own_pid)),
        Err(ShellMiss) => None,
    };
    edge.observe(fullscreen)
}

pub struct FullscreenSensor;

impl Sensor for FullscreenSensor {
    fn name(&self) -> &'static str {
        "fullscreen"
    }

    fn start(&self, tx: std::sync::mpsc::Sender<FioreEvent>) -> Result<(), SensorError> {
        #[cfg(windows)]
        {
            start_windows(tx)
        }
        #[cfg(not(windows))]
        {
            let _ = tx;
            Err(SensorError::Failed(
                "fullscreen sensor requires windows".to_string(),
            ))
        }
    }
}

#[cfg(windows)]
struct WindowsFullscreenSource;

#[cfg(windows)]
impl FullscreenSource for WindowsFullscreenSource {
    fn sample(&self) -> Sample {
        // HWND and HMONITOR are stale as soon as we return them, so every poll queries again.
        Sample {
            shell: query_shell(),
            window: query_window(),
        }
    }
}

#[cfg(windows)]
fn start_windows(tx: std::sync::mpsc::Sender<FioreEvent>) -> Result<(), SensorError> {
    let _com = ComGuard::mta().map_err(|err| {
        tracing::warn!(sensor = "fullscreen", error = %err, "com init failed");
        SensorError::Failed(err.to_string())
    })?;
    let source = WindowsFullscreenSource;
    let mut edge = Edge::new();
    let own_pid = std::process::id();
    loop {
        let sample = source.sample();
        if let Some(event) = step(&mut edge, sample.shell, sample.window.as_ref(), own_pid) {
            if tx.send(event).is_err() {
                break;
            }
        }
        thread::park_timeout(POLL_INTERVAL);
    }
    Ok(())
}

#[cfg(windows)]
fn query_shell() -> Result<ShellState, ShellMiss> {
    // SAFETY: the shell query writes one state enum and borrows nothing from this function.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => Ok(map_shell(state)),
        Err(err) => {
            tracing::debug!(sensor = "fullscreen", error = %err, "shell query failed");
            Err(ShellMiss)
        }
    }
}

#[cfg(windows)]
fn map_shell(state: QUERY_USER_NOTIFICATION_STATE) -> ShellState {
    match state {
        QUNS_NOT_PRESENT => ShellState::NotPresent,
        QUNS_BUSY => ShellState::Busy,
        QUNS_RUNNING_D3D_FULL_SCREEN => ShellState::RunningD3dFullScreen,
        QUNS_PRESENTATION_MODE => ShellState::PresentationMode,
        QUNS_ACCEPTS_NOTIFICATIONS => ShellState::AcceptsNotifications,
        QUNS_QUIET_TIME => ShellState::QuietTime,
        QUNS_APP => ShellState::App,
        _ => ShellState::AcceptsNotifications,
    }
}

#[cfg(windows)]
fn query_window() -> Option<WindowSample> {
    let foreground = win::foreground()?;
    let (window, monitor) = monitor_rects(foreground.hwnd)?;
    Some(WindowSample {
        class: foreground.class,
        pid: foreground.pid,
        window,
        monitor,
    })
}

#[cfg(windows)]
fn monitor_rects(hwnd: HWND) -> Option<(Rect, Rect)> {
    // SAFETY: user32 queries. `cbSize` is set before GetMonitorInfoW writes the struct.
    // A failed call returns before either rect is read.
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_invalid() {
            return None;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..MONITORINFO::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let mut window = RECT::default();
        GetWindowRect(hwnd, &mut window).ok()?;
        Some((rect_from(window), rect_from(info.rcMonitor)))
    }
}

#[cfg(windows)]
fn rect_from(rect: RECT) -> Rect {
    Rect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor() -> Rect {
        Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        }
    }

    fn window(class: &str, pid: u32, rect: Rect) -> WindowSample {
        WindowSample {
            class: class.to_string(),
            pid,
            window: rect,
            monitor: monitor(),
        }
    }

    #[test]
    fn shell_blocks_matches_all_seven_quns_values() {
        let cases = [
            (ShellState::NotPresent, false),
            (ShellState::Busy, true),
            (ShellState::RunningD3dFullScreen, true),
            (ShellState::PresentationMode, true),
            (ShellState::AcceptsNotifications, false),
            (ShellState::QuietTime, false),
            (ShellState::App, false),
        ];
        assert_eq!(cases.len(), 7);
        for (state, blocked) in cases {
            assert_eq!(shell_blocks(state), blocked, "{state:?}");
        }
    }

    #[test]
    fn window_larger_than_the_monitor_covers_it() {
        let bigger = Rect {
            left: -8,
            top: -8,
            right: 1928,
            bottom: 1088,
        };
        assert!(covers(bigger, monitor()));
        assert!(covers(monitor(), monitor()));
        let short = Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1000,
        };
        assert!(!covers(short, monitor()));
    }

    #[test]
    fn maximized_work_area_window_does_not_cover_the_monitor() {
        // Work area stops above the taskbar. Borders hang past that edge and still miss rcMonitor.
        let work = Rect {
            left: -8,
            top: -8,
            right: 1928,
            bottom: 1048,
        };
        assert!(!covers(work, monitor()));
        let sample = window("Notepad", 42, work);
        assert!(!decide(ShellState::AcceptsNotifications, Some(&sample), 1));
    }

    #[test]
    fn ac_fs_4_own_pid_and_desktop_classes_never_count() {
        let own = 7u32;
        let covering = Rect {
            left: -8,
            top: -8,
            right: 1928,
            bottom: 1088,
        };
        let pet = window("Fiore", own, covering);
        assert!(excluded(&pet.class, pet.pid, own));
        assert!(!decide(ShellState::AcceptsNotifications, Some(&pet), own));

        for class in ["Progman", "WorkerW", "Shell_TrayWnd"] {
            assert!(excluded(class, 99, own), "{class}");
            let shell = window(class, 99, covering);
            assert!(
                !decide(ShellState::AcceptsNotifications, Some(&shell), own),
                "{class}"
            );
        }

        assert!(!excluded("Notepad", 42, own));
        assert!(!excluded("progman", 99, own));
        let foreign = window("Notepad", 42, covering);
        assert!(decide(
            ShellState::AcceptsNotifications,
            Some(&foreign),
            own
        ));
    }

    #[test]
    fn busy_shell_is_fullscreen_without_a_covering_window() {
        assert!(decide(ShellState::Busy, None, 1));
        assert!(decide(ShellState::RunningD3dFullScreen, None, 1));
        assert!(decide(ShellState::PresentationMode, None, 1));
        assert!(!decide(ShellState::NotPresent, None, 1));
        assert!(!decide(ShellState::QuietTime, None, 1));
        assert!(!decide(ShellState::App, None, 1));
    }

    #[test]
    fn edge_emits_baseline_then_only_on_change() {
        let mut edge = Edge::new();
        let entered = step(&mut edge, Ok(ShellState::Busy), None, 1);
        assert_eq!(entered, Some(FioreEvent::FullscreenEntered {}));
        assert!(step(&mut edge, Ok(ShellState::Busy), None, 1).is_none());
        assert!(step(&mut edge, Ok(ShellState::PresentationMode), None, 1).is_none());

        let exited = step(&mut edge, Ok(ShellState::AcceptsNotifications), None, 1);
        assert_eq!(exited, Some(FioreEvent::FullscreenExited {}));
        assert!(step(&mut edge, Ok(ShellState::AcceptsNotifications), None, 1).is_none());
        assert!(step(&mut edge, Ok(ShellState::QuietTime), None, 1).is_none());
    }

    #[test]
    fn shell_error_keeps_the_previous_fullscreen_bit() {
        let mut edge = Edge::new();
        assert!(step(&mut edge, Err(ShellMiss), None, 1).is_none());

        assert_eq!(
            step(&mut edge, Ok(ShellState::Busy), None, 1),
            Some(FioreEvent::FullscreenEntered {})
        );
        let open = window(
            "Notepad",
            9,
            Rect {
                left: 10,
                top: 10,
                right: 200,
                bottom: 200,
            },
        );
        assert!(step(&mut edge, Err(ShellMiss), Some(&open), 1).is_none());
        assert!(step(&mut edge, Ok(ShellState::Busy), Some(&open), 1).is_none());

        assert_eq!(
            step(
                &mut edge,
                Ok(ShellState::AcceptsNotifications),
                Some(&open),
                1
            ),
            Some(FioreEvent::FullscreenExited {})
        );
        assert!(step(&mut edge, Err(ShellMiss), None, 1).is_none());
        assert!(step(&mut edge, Ok(ShellState::App), Some(&open), 1).is_none());
    }

    #[test]
    fn poll_interval_is_500_ms() {
        assert_eq!(POLL_INTERVAL, Duration::from_millis(500));
    }
}
