# Windows API recipes (Fiore sensors)

Purpose: verified snippets and pitfalls for the five Win32/WinRT calls the sensors use. Crate rules (version, features, COM init, async) are in `windows-crate.md`; read that first.
last-verified: 2026-11-07

Verification key: **[doc]** fetched Microsoft page, **[src]** `windows 0.62.2` crate source, **[run]** compiled and executed in a scratch crate on Win 11 10.0.26300 with `windows = "0.62"` and the feature list from `windows-crate.md`, **[unverified]** common practice, check with a simulator.

All snippets assume the calling thread already holds a COM/WinRT guard (`windows-crate.md` §3) and are wrapped in a safe function per the unsafe rule in `conventions.md`.

---

## 1. GSMTC (global media session) — `music.started/track_changed/stopped`

Features: `Media_Control`, `Foundation` (+ `Foundation_Collections` for `GetSessions`). Sensor file: `sensors/media.rs`.

Documented facts **[doc]**:
- `GlobalSystemMediaTransportControlsSessionManager` (Windows 10 1809+): `RequestAsync()` (static), `GetCurrentSession()`, `GetSessions()`, events `CurrentSessionChanged`, `SessionsChanged`. Marked agile. Listed capability `globalMediaControl`; an unpackaged desktop exe still received data **[run]**, so no manifest capability is needed here.
- Session: `SourceAppUserModelId`, `GetPlaybackInfo()`, `TryGetMediaPropertiesAsync()`, events `PlaybackInfoChanged`, `MediaPropertiesChanged`, `TimelinePropertiesChanged`.
- `…PlaybackStatus` enum: Closed 0, Opened 1, Changing 2, Stopped 3, **Playing 4**, Paused 5.
- Media properties: `Title`, `Artist`, `AlbumTitle`, `PlaybackType`, `Thumbnail` (needs `Storage_Streams`; we do not use it).

Poll-once snippet **[run]**:

```rust
use windows::core::Result;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

pub struct Playing { pub title: String, pub artist: String, pub app: String }

pub fn now_playing() -> Result<Option<Playing>> {
    let mgr = Manager::RequestAsync()?.join()?;           // 0.62: join(), not get()
    let Ok(session) = mgr.GetCurrentSession() else {       // null session -> Err(empty), see below
        return Ok(None);
    };
    if session.GetPlaybackInfo()?.PlaybackStatus()? != Status::Playing {
        return Ok(None);
    }
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    Ok(Some(Playing {
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        app: session.SourceAppUserModelId()?.to_string(),
    }))
}
```

Event-driven subscription **[run: compiled]**; handler only signals, the sensor loop does the reads:

```rust
use windows::Foundation::TypedEventHandler;

pub fn subscribe(mgr: &Manager, tx: std::sync::mpsc::Sender<()>) -> Result<i64> {
    mgr.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        let _ = tx.send(()); // runs on a thread-pool thread; no real work here
        Ok(())
    }))
}
pub fn unsubscribe(mgr: &Manager, token: i64) -> Result<()> { mgr.RemoveCurrentSessionChanged(token) }
```

Pitfalls:
- `GetCurrentSession()` with nothing registered returns `Err` with an empty code (null mapped by the projection) **[src]**. That is the normal "no media" state: map it to `Ok(None)`, do not log as an error.
- **`SourceAppUserModelId` is not an exe name.** Chrome returned `Chrome.UserData.Profile1` **[run]**. Show it as `sourceApp` as-is; do not match it against process names.
- `GetCurrentSession` is "the session the system believes the user would most likely want to control" **[doc]**; other sessions may also be playing. For "is anything playing" iterate `GetSessions()`. Decide this once in the spec/sensor, not per call.
- A browser tab playing video reports `Playing` as well. `PlaybackType` exists on the media properties **[doc]**, but whether it reliably separates music from video was not verified **[unverified]**; the spec treats any `Playing` as music.
- `PlaybackInfoChanged` can fire in bursts and per session. Re-read state in the sensor loop and debounce; the 2-second `music.stopped` debounce in the spec covers pause/track-switch gaps.
- Track change shows up through `MediaPropertiesChanged` (new `Title`/`Artist`); fields can be empty strings during a switch **[unverified]**; ignore empty titles.
- To follow all sessions, subscribe to `SessionsChanged`, then rebuild per-session subscriptions (`PlaybackInfoChanged`, `MediaPropertiesChanged`) and remove old tokens first.
- Each `.join()` can block indefinitely (`windows-crate.md` §4); keep it on the sensor thread.
- Privacy: titles and artists are logged only at debug level.

---

## 2. `IAudioMeterInformation` — `music.level { peak }`

Features: `Win32_Media_Audio`, `Win32_Media_Audio_Endpoints`, `Win32_System_Com`, **`Win32_System_Com_StructuredStorage` + `Win32_System_Variant`** (for `Activate`). Sensor file: `sensors/audio_peak.rs`.

Documented facts **[doc]**:
- Obtain it with `IMMDevice::Activate(IID_IAudioMeterInformation, …)`; `pActivationParams` must be NULL for this interface.
- `GetPeakValue` returns a float normalized to 0.0–1.0 and always reports the peak of the **previous** device period.
- The meter reads the stream **before** the endpoint volume attenuation: muting or lowering system volume does not reduce it.
- It is a peak for the whole endpoint (all apps and system sounds), not per app.
- Exclusive mode with no hardware meter reports 0.0.
- `GetDefaultAudioEndpoint` returns `E_NOTFOUND`/`ERROR_NOT_FOUND` when no device exists. `Activate` can return `AUDCLNT_E_DEVICE_INVALIDATED` when the device is removed. Since Windows Vista every role resolves to the same default device.

Snippet **[run]** (peak 0.52 while music played):

```rust
use windows::core::Result;
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

pub struct Meter(IAudioMeterInformation);

impl Meter {
    pub fn open_default() -> Result<Self> {
        unsafe {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
            Ok(Self(dev.Activate(CLSCTX_ALL, None)?)) // type is inferred from the field
        }
    }
    pub fn peak(&self) -> Result<f32> { unsafe { self.0.GetPeakValue() } }
}
```

Pitfalls:
- Create the meter once and reuse it for each ~15 Hz tick. On any `Err` from `peak()`, drop it and re-open with backoff (device unplugged or default device changed). Only `IMMNotificationClient` (not used) would tell you of a default-device change; re-opening on error plus a slow periodic re-open (for example every 30 s) is the cheap alternative **[unverified]**.
- The peak says "some audio is playing", not "music". Gate dancing on GSMTC `Playing`; use the peak only for `music.level` while music is playing.
- Because the meter ignores system volume, a muted PC can still show peaks. Do not infer "the user can hear it".
- Apply a smoothing/noise floor in the TS engine, not here; the sensor sends raw clamped 0.0–1.0 values.
- Do not open the meter per tick (`CoCreateInstance` + `Activate` each time is wasted CPU against the <1% budget).

---

## 3. `SHQueryUserNotificationState` — `fullscreen.entered/exited`

Feature: `Win32_UI_Shell`. Sensor file: `sensors/fullscreen.rs`.

Rust signature **[src]**: `pub unsafe fn SHQueryUserNotificationState() -> Result<QUERY_USER_NOTIFICATION_STATE>`; the enum is a newtype over `i32` (`.0`), compare with the `QUNS_*` constants.

Documented values **[doc]**:

| Constant | Value | Meaning |
|---|---|---|
| `QUNS_NOT_PRESENT` | 1 | screen saver, machine locked, or inactive Fast User Switching session |
| `QUNS_BUSY` | 2 | a full-screen application is running or Presentation Settings are applied |
| `QUNS_RUNNING_D3D_FULL_SCREEN` | 3 | full-screen (exclusive) Direct3D app |
| `QUNS_PRESENTATION_MODE` | 4 | user enabled Windows presentation settings |
| `QUNS_ACCEPTS_NOTIFICATIONS` | 5 | none of the others |
| `QUNS_QUIET_TIME` | 6 | first hour after first logon / OS upgrade (Win7+) |
| `QUNS_APP` | 7 | a Windows Store app is running (Win8+) |

During quiet time, if another blocked state applies, only that state is returned **[doc]**.

Snippet **[run]** (returned `Ok(false)` on the normal desktop):

```rust
use windows::core::Result;
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};

pub fn shell_says_fullscreen() -> Result<bool> {
    let s = unsafe { SHQueryUserNotificationState()? };
    Ok(s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
}
```

Pitfalls:
- **No change notification for fullscreen.** Documentation: top-level windows get `WM_SETTINGCHANGE` for presentation settings and lock/unlock, but "there are no notifications sent when the user starts or stops a full-screen application" **[doc]**. The sensor must poll (spec performance section: fullscreen poll interval <= 500 ms, emit only on state change).
- `QUNS_NOT_PRESENT` (locked/screen saver) and `QUNS_APP` (Store app) are not in the spec's trigger set. Do not map them to fullscreen without a spec change.
- On `Err`, treat the state as "unknown": keep the previous value, do not emit an event.
- The call is a hint. The spec also ORs in a window-rect check (section 5); a borderless-windowed game can match the rect but not the shell state **[unverified]**, so debounce transitions (enter and exit) before emitting if the simulator shows flapping.
- The pet's own window is excluded from the rect check (compare PID with `std::process::id()`).

---

## 4. `GetForegroundWindow` + `QueryFullProcessImageNameW` — `app.category_changed`

Features: `Win32_UI_WindowsAndMessaging`, `Win32_System_Threading`, `Win32_Foundation`. Sensor file: `sensors/foreground.rs`.

Documented facts **[doc]**:
- `GetForegroundWindow()` can return NULL "in certain circumstances, such as when a window is losing activation".
- `GetWindowThreadProcessId(hwnd, &mut pid)` returns the thread id, or 0 for an invalid handle.
- `QueryFullProcessImageNameW` needs a handle opened with `PROCESS_QUERY_INFORMATION` or `PROCESS_QUERY_LIMITED_INFORMATION`. `lpdwSize` is in characters: in = buffer size, out = characters written excluding the NUL. Flag `0` (`PROCESS_NAME_WIN32`) gives a Win32 path.
- `PROCESS_QUERY_LIMITED_INFORMATION` (0x1000) is the right request, and it is still allowed on protected processes where `PROCESS_QUERY_INFORMATION` is not.

Rust signatures **[src]**: `GetForegroundWindow() -> HWND` (not a `Result`); `GetWindowThreadProcessId(HWND, Option<*mut u32>) -> u32`; `OpenProcess(PROCESS_ACCESS_RIGHTS, bool, u32) -> Result<HANDLE>`; `QueryFullProcessImageNameW(HANDLE, PROCESS_NAME_FORMAT, PWSTR, *mut u32) -> Result<()>`.

Snippet **[run]** (returned `…\chrome.exe`, class `Chrome_WidgetWin_1`):

```rust
use windows::core::{Owned, Result, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

pub struct Foreground { pub hwnd: HWND, pub pid: u32, pub exe: Option<String>, pub title: String, pub class: String }

pub fn foreground() -> Option<Foreground> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() { return None; }
        let mut pid = 0u32;
        if GetWindowThreadProcessId(hwnd, Some(&mut pid)) == 0 || pid == 0 { return None; }
        let mut t = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut t);
        let mut c = [0u16; 256];
        let m = GetClassNameW(hwnd, &mut c);
        Some(Foreground {
            hwnd, pid,
            exe: exe_path(pid).ok(),
            title: String::from_utf16_lossy(&t[..n.max(0) as usize]),
            class: String::from_utf16_lossy(&c[..m.max(0) as usize]),
        })
    }
}

fn exe_path(pid: u32) -> Result<String> {
    unsafe {
        let h = Owned::new(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?); // CloseHandle on drop
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        QueryFullProcessImageNameW(*h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)?;
        Ok(String::from_utf16_lossy(&buf[..len as usize]))
    }
}
```

Pitfalls:
- NULL foreground is normal (focus transitions); skip the tick. Do not emit `other` for it.
- `OpenProcess` can fail (access denied for some system or elevated processes **[unverified]**); `exe` is `None`; fall back to title-keyword matching or `other`. Never panic or disable the sensor for this.
- Match the **file name**, case-insensitively: `Path::new(&exe).file_name()` then `eq_ignore_ascii_case` (`WINWORD.EXE`, `Code.exe`, `Cursor.exe` vs lowercase forms).
- Buffer: 1024 chars is enough for normal paths; if the call fails for size, retry with a larger buffer. `len` is the written count; never index with the buffer size.
- Modern Store/UWP windows are hosted by `ApplicationFrameHost.exe`, so the PID belongs to the host and not the app **[unverified]**; the spec's category list does not depend on it.
- The pet's own window must be ignored (PID == `std::process::id()`), otherwise dragging the pet changes the category.
- Cache the previous `(pid, exe)`; `OpenProcess` per 500 ms poll is cheap, but skip it when the `hwnd`/`pid` pair is unchanged.
- Window titles are private: matched in memory, logged at debug level only.

---

## 5. `MonitorFromWindow` (+ `GetMonitorInfoW`, `GetWindowRect`) — fullscreen rect check

Features: `Win32_Graphics_Gdi`, `Win32_UI_WindowsAndMessaging`, `Win32_Foundation`. Also in `sensors/fullscreen.rs`.

Documented facts **[doc]**:
- `MonitorFromWindow(hwnd, flags)` returns the monitor with the largest intersection with the window. If the window intersects none, `MONITOR_DEFAULTTONEAREST` returns the nearest monitor, `MONITOR_DEFAULTTONULL` returns NULL, `MONITOR_DEFAULTTOPRIMARY` returns the primary. A minimized window uses its rectangle from before minimizing.
- `GetMonitorInfoW`: set `cbSize` to `sizeof(MONITORINFO)` first. Returns 0 on failure.
- `GetWindowRect`: screen coordinates, bottom/right exclusive, **virtualized for DPI**, and **may include invisible resize borders** (Vista+). `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` gives visible bounds and is not DPI-adjusted.

Rust signatures **[src]**: `MonitorFromWindow(HWND, MONITOR_FROM_FLAGS) -> HMONITOR`; `GetMonitorInfoW(HMONITOR, *mut MONITORINFO) -> BOOL`.

Snippet **[run]**:

```rust
use std::mem::size_of;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

pub fn covers_monitor(hwnd: HWND) -> bool {
    unsafe {
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() { return false; }
        let mut r = RECT::default();
        if GetWindowRect(hwnd, &mut r).is_err() { return false; }
        r.left <= mi.rcMonitor.left && r.top <= mi.rcMonitor.top
            && r.right >= mi.rcMonitor.right && r.bottom >= mi.rcMonitor.bottom
    }
}
```

Pitfalls:
- **Use `<=`/`>=` containment, not equality** (the plan text says "equals"): invisible borders make the window rect larger than the monitor rect **[doc]**.
- Compare against `rcMonitor` (full monitor), not `rcWork` (excludes the taskbar).
- Exclude the desktop and shell windows before the check. Typical class names are `Progman`, `WorkerW`, `Shell_TrayWnd` **[unverified]**; the hidden desktop window otherwise covers the monitor. Read the class with `GetClassNameW` (section 4).
- A maximized normal window should not match. Its rect is the work area plus borders, so with an auto-hide taskbar it may cover the whole monitor **[unverified]**; if the simulator shows false positives, additionally require no caption style (`GetWindowLongPtrW(GWL_STYLE)` lacking `WS_CAPTION`) **[unverified]**.
- DPI: the process must be per-monitor DPI-aware for rects and monitor info to be in the same physical coordinates. Tauri's manifest handles this; do not call `SetProcessDPIAware*` ourselves. If values look scaled, compare against `GetMonitorInfoW` from the same process, never against Tauri's logical sizes.
- `MONITOR_DEFAULTTONEAREST` always yields a monitor; do not treat a non-null result as proof the window is on that monitor.
- Multi-monitor: the check uses only the foreground window's own monitor. The spec does not define per-monitor behavior for the pet; do not invent it in the sensor.
- `HMONITOR` and `HWND` are not owned and go stale; re-query on every poll.

---

## Quick reference: which thread and cadence

| Sensor | Thread init | Cadence (spec) | Blocking risk |
|---|---|---|---|
| media (GSMTC) | `RoInitialize` MTA, own thread | event driven + re-read | `.join()` no timeout |
| audio_peak | `RoInitialize`/COM MTA, own thread | about 15 Hz while music plays | none after open |
| fullscreen | any thread; MTA guard anyway | poll <= 500 ms | none |
| foreground | any thread | poll 500 ms | none |

## Sources

Microsoft Learn (fetched 2026-11-07):
- https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate
- https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew
- https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmonitorinfow
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect
- https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudiometerinformation
- https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nf-endpointvolume-iaudiometerinformation-getpeakvalue
- https://learn.microsoft.com/en-us/windows/win32/coreaudio/peak-meters
- https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdeviceenumerator-getdefaultaudioendpoint
- https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdevice-activate
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager?view=winrt-26100
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession?view=winrt-26100
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionplaybackstatus?view=winrt-26100
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties?view=winrt-26100

Crate source (`windows-0.62.2`, `windows-core-0.62.2`, `windows-future-0.3.2`) and the scratch crate `%TEMP%\fiore-winapi-check` for signatures and **[run]** results.
