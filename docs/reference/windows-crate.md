# `windows` crate reference (Fiore)

Purpose: verified rules for using the `windows` crate in `src-tauri/` — version pin, Cargo features, COM/WinRT init, async, handle lifetimes, pitfalls. API-specific snippets live in `win-apis.md`.
last-verified: 2026-11-07

Verification key: **[doc]** from a fetched Microsoft/crate page, **[src]** read from the published crate source, **[run]** compiled and executed in a scratch project (Win 11 10.0.26300, rustc 1.93.1), **[unverified]** common practice, confirm with a simulator before relying on it.

## 1. Version pin

- Pin `windows = "0.62"` (latest published 0.62.2 on crates.io, MSRV 1.82) **[src]**.
- Tauri 2.12.5, `tauri-runtime-wry` 2.12.3, `wry` 0.57.1 and `tao` 0.37.2 all depend on `windows 0.62` **[src: their Cargo.toml]**. Stay on 0.62 so `HWND`/`HANDLE` from Tauri and from our code are the same type. A different minor version compiles but the types do not interoperate.
- Do not copy code from the `master` readme or from `microsoft.github.io/windows-docs-rs`: they track unreleased code (the master readme shows `windows = "0.100"` and `init_mta()`). `docs.rs/windows` is only a stub that redirects there **[doc]**. 0.62.2 has no `init_mta`/`init_sta` **[src]**.
- Resolve the real API by reading the crate source: `~/.cargo/registry/src/*/windows-0.62.2/src/Windows/<Namespace>/mod.rs`. `rg "fn SHQueryUserNotificationState"` is faster than any web page.

## 2. Cargo feature flags

Features mirror the namespace path: `Win32::UI::Shell` → `Win32_UI_Shell`; WinRT `Windows.Media.Control` → `Media_Control`. Each feature enables its parent **[src: Cargo.toml `Win32_UI_Shell = ["Win32_UI"]`]**.

```toml
# src-tauri/Cargo.toml
[target.'cfg(windows)'.dependencies.windows]
version = "0.62"
features = [
  "Win32_Foundation",                    # name HWND, HANDLE, RECT
  "Win32_Graphics_Gdi",                  # MonitorFromWindow, GetMonitorInfoW, MONITORINFO
  "Win32_Media_Audio",                   # IMMDeviceEnumerator, MMDeviceEnumerator, eRender/eConsole
  "Win32_Media_Audio_Endpoints",         # IAudioMeterInformation
  "Win32_System_Com",                    # CoInitializeEx, CoCreateInstance, CLSCTX_*
  "Win32_System_Com_StructuredStorage",  # IMMDevice::Activate (PROPVARIANT param) -- see below
  "Win32_System_Variant",                # IMMDevice::Activate -- see below
  "Win32_System_Threading",              # OpenProcess, QueryFullProcessImageNameW
  "Win32_System_WinRT",                  # RoInitialize
  "Win32_UI_Shell",                      # SHQueryUserNotificationState
  "Win32_UI_WindowsAndMessaging",        # GetForegroundWindow, GetWindowRect, GetWindowTextW, ...
  "Media_Control",                       # GSMTC
  "Foundation",                          # TypedEventHandler, IAsyncOperation
  "Foundation_Collections",              # only for GetSessions() -> IVectorView
]
```

| API | Feature(s) | Verified |
|---|---|---|
| `SHQueryUserNotificationState`, `QUERY_USER_NOTIFICATION_STATE`, `QUNS_*` | `Win32_UI_Shell` | [run] |
| `GetForegroundWindow`, `GetWindowThreadProcessId`, `GetWindowRect`, `GetWindowTextW`, `GetClassNameW` | `Win32_UI_WindowsAndMessaging` | [run] |
| `OpenProcess`, `QueryFullProcessImageNameW`, `PROCESS_QUERY_LIMITED_INFORMATION`, `PROCESS_NAME_WIN32` | `Win32_System_Threading` | [run] |
| `MonitorFromWindow`, `GetMonitorInfoW`, `MONITORINFO`, `MONITOR_DEFAULTTONEAREST` | `Win32_Graphics_Gdi` | [run] |
| `CoInitializeEx`, `CoUninitialize`, `CoCreateInstance`, `CLSCTX_ALL`, `COINIT_*` | `Win32_System_Com` | [run] |
| `RoInitialize`, `RoUninitialize`, `RO_INIT_MULTITHREADED` | `Win32_System_WinRT` | [run] |
| `IMMDeviceEnumerator`, `MMDeviceEnumerator`, `eRender`, `eConsole` | `Win32_Media_Audio` | [run] |
| `IMMDevice::Activate` | `Win32_System_Com_StructuredStorage` **and** `Win32_System_Variant` (+ `Win32_System_Com` for `CLSCTX`) | [src] + [run] |
| `IAudioMeterInformation` | `Win32_Media_Audio_Endpoints` | [run] |
| `GlobalSystemMediaTransportControls*` | `Media_Control` (+ `Foundation` for handlers/async) | [run] |
| `Manager::GetSessions()` / `IVectorView` | `Foundation_Collections` | [run] |

Rules:
- **Methods can have their own `cfg`.** `IMMDevice::Activate` is gated `all(feature = "Win32_System_Com_StructuredStorage", feature = "Win32_System_Variant")` **[src]**. Without both, the error is a bare `no method named Activate found`. Whenever a method "does not exist", `rg` its definition and read the `#[cfg(...)]` above it.
- Free functions we use (`SHQuery…`, `QueryFullProcessImageNameW`, `MonitorFromWindow`) carry no extra `cfg` beyond their namespace feature **[src]**. `Win32_UI_Shell`, `Win32_System_Threading` and `Win32_UI_WindowsAndMessaging` each compiled with only their own namespace feature **[run]**, but keep `Win32_Foundation` on so `HWND`/`HANDLE`/`RECT` can be named.
- Feature unification: Tauri enables its own `windows` features, and cargo unions them. Our list must still be complete on its own; never rely on Tauri having enabled one.
- Enable only what is used; the `windows` crate compile time scales with the feature count. Sensors are the only users (`src-tauri/src/sensors/*`, `window.rs`).
- `windows-sys` is a different crate (raw FFI, no COM/WinRT). Do not mix it into this project.

## 3. COM / WinRT initialization

Facts:
- `CoInitializeEx` must be called on each thread that uses COM; the same flag may be repeated (returns `S_FALSE`), a different flag fails with `RPC_E_CHANGED_MODE`; **every successful call, including `S_FALSE`, needs a matching `CoUninitialize`** **[doc]**.
- `RoInitialize` is the equivalent for WinRT (`RO_INIT_MULTITHREADED` default); every success incl. `S_FALSE` needs `RoUninitialize` **[doc]**. Microsoft says to initialize with the WinRT call when you use WinRT, or WinRT+COM together; WinRT init is sufficient for COM components **[doc: CoInitializeEx remarks]**.
- windows-rs maps `HRESULT` to `Result`: `S_FALSE` (0x1) is `Ok` through `.ok()` **[run: second MTA init returned 0x00000001, `.ok()` is Ok]**. `RPC_E_CHANGED_MODE` (0x80010106) is `Err` **[run]**.
- **Tauri's main thread is an STA** (tao calls `OleInitialize` for drag-and-drop and `CoInitializeEx(COINIT_APARTMENTTHREADED)`; wry does the same) **[src: tao 0.37.2 `window.rs`, wry 0.57.1 `webview2/mod.rs`]**. Never call an MTA init on the main thread, and never run sensors there.
- Sensors run on their own `std::thread` (architecture.md). Each such thread initializes MTA itself and holds a guard for its lifetime.

Guard pattern **[run: compiled]** (one per sensor thread; use only one of the two, `RoInitialize` covers sensors that use both COM and WinRT):

```rust
use windows::core::Result;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

pub struct WinRtGuard; // !Send by intent: create it inside the thread that uses it
impl WinRtGuard {
    pub fn mta() -> Result<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? }; // Ok on S_FALSE too
        Ok(Self)
    }
}
impl Drop for WinRtGuard {
    fn drop(&mut self) { unsafe { RoUninitialize() } } // must balance every Ok init
}
```

COM-only variant: `unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? }` + `CoUninitialize()` in `Drop`.

Rules:
- Create the guard first on the thread, and drop COM/WinRT objects **before** the guard (declare the guard first so it drops last).
- If init returns `RPC_E_CHANGED_MODE`, the thread was already an STA: you are on the wrong thread. Move the work to a fresh thread; do not "fall back".
- **Observed, not guaranteed [run]:** on a plain `std::thread` with no init at all, GSMTC, `CoCreateInstance` (audio meter) and `SHQueryUserNotificationState` all worked here, presumably through the implicit MTA. Microsoft documents that COM must be initialized first (`CO_E_NOTINITIALIZED` otherwise) **[doc]**. Always init explicitly; do not depend on the implicit MTA.
- `SHQueryUserNotificationState` and the plain user32/kernel32 calls (`GetForegroundWindow`, `OpenProcess`, `MonitorFromWindow`, …) are not documented as needing COM; they ran fine without init **[run]**.

## 4. WinRT async: `.join()`, not `.get()`

- In 0.62.2 the blocking wait on `IAsyncOperation<T>`/`IAsyncAction` is **`.join()`**. There is no `.get()` **[src: windows-future 0.3.2 `join.rs`; `Manager::RequestAsync()?.join()?` compiled and ran [run]]**. Older snippets and blog posts use `.get()`; they do not compile on 0.62.
- `.join()` blocks on a Win32 event with **no timeout** (`WaitForSingleObject(…, INFINITE)` also runs in the waiter's `Drop`) **[src: `waiter.rs`]**. A GSMTC call that never completes hangs the sensor thread. Only call it from the sensor's dedicated thread, never from the Tauri main thread or async runtime workers.
- Async types implement `IntoFuture`, so `.await` works on any executor **[src: `future.rs`]**; prefer `.join()` on the dedicated sensor thread to avoid pulling in a runtime.
- `.join()` on an STA thread also ran fine for GSMTC **[run]** because the GSMTC classes are agile (`MarshalingBehavior(Agile)`) **[doc]**. Do not generalize that to non-agile classes.
- Event handlers: `TypedEventHandler::new(|sender, args| { … Ok(()) })` takes a `Send + 'static` closure and runs on an arbitrary thread-pool thread **[src/run]**. Do no real work in it: send a message over a channel to the sensor loop and return.
- Handlers stay registered until you call the matching `Remove…(token)` (token is `i64`). Dropping your Rust handle does not unregister. Keep the event source object alive while subscribed, and remove tokens before replacing sessions.

## 5. Handles, strings, results

- `HWND`, `HMONITOR` are plain `Copy` wrappers around a pointer, **not owned**. They can become invalid at any time (window closed between calls). Never store them across polls; re-query each tick. Use `hwnd.is_invalid()` for null **[run]**.
- `HANDLE` from `OpenProcess` is owned: wrap in `windows::core::Owned::new(handle)` so `CloseHandle` runs on every path; deref with `*h` to pass the raw handle **[run]**. `core::Owned` is the documented guard type **[doc: windows-core readme says "Put owned resources in guards before further fallible work"]**.
- Interfaces (`IMMDevice`, GSMTC objects) are ref-counted; `Clone` adds a reference and `Drop` releases. Never call `Release` yourself.
- Return-value mapping: `HRESULT` → `Result<T>`; out-params become return values; `BOOL` returns stay `BOOL` for some APIs (`GetMonitorInfoW` returns `BOOL`: use `.as_bool()`) and become `Result<()>` for others (`GetWindowRect`, `QueryFullProcessImageNameW`) **[src]**. Read the generated signature in the crate source, do not translate the C prototype by hand.
- A null interface return from a non-optional method (for example `GetCurrentSession()` with no session) becomes `Err` with an empty error code (`Error::empty()`), not a panic **[src: `windows-core` `type.rs`, `windows-result` `error.rs`]**. Treat it as "nothing there", not as a failure to log at `error`.
- Failure from `BOOL`-returning APIs: capture `Error::from_thread()` immediately **[doc: readme]**.
- Strings: `HSTRING` implements `Display`, so `.to_string()` works **[run]**. `PWSTR(buf.as_mut_ptr())` for output buffers; decode with `String::from_utf16_lossy(&buf[..len])`. Window titles and file paths are not guaranteed valid UTF-16.
- The crate's own guidance: keep `unsafe` in small wrappers that uphold pointer, lifetime, threading and initialization requirements **[doc: readme]**. This matches the unsafe-comment rule in `conventions.md`.

## 6. Pitfalls checklist

1. Wrong crate version (≠ 0.62) → type mismatch with Tauri's `HWND`. (§1)
2. Missing method with no clear error → method-level `cfg`; read source. (§2)
3. `.get()` from old examples → use `.join()`. (§4)
4. MTA init on the main thread → `RPC_E_CHANGED_MODE`; sensors belong on their own threads. (§3)
5. Unbalanced `CoUninitialize`/`RoUninitialize` (also for `S_FALSE`) → use a guard. (§3)
6. Leaking `HANDLE` → `Owned`. Storing `HWND` across polls → stale handle. (§5)
7. `.join()` has no timeout → keep it on a sensor thread; the sensor must tolerate being stuck, and the hub must not wait on it.
8. WinRT event handlers run on foreign threads and are never auto-unregistered. (§4)
9. Panicking (`unwrap`) in a sensor thread kills the sensor silently; return `Result`, log, disable the sensor (architecture error policy).
10. Docs/blogs written against `windows` ≤ 0.5x use different module paths and `Param` conventions; trust only 0.62 source.
11. Do not rely on the implicit MTA that happened to work in the experiment. (§3)

## Sources

- https://github.com/microsoft/windows-rs (readme, raw `crates/libs/windows/readme.md`, master; version/`init_mta` differences noted above)
- https://docs.rs/windows/latest/windows/ (stub, 0.62.2) and https://crates.io/api/v1/crates/windows (versions, MSRV)
- https://static.crates.io/crates/windows/windows-0.62.2.crate, `windows-core-0.62.2`, `windows-future-0.3.2`, `windows-result-0.4.1` (source read)
- `wry-0.57.1`, `tao-0.37.2`, `tauri-runtime-wry-2.12.3`, `tauri-2.12.5` crate sources (`windows` dependency version, STA init)
- https://learn.microsoft.com/en-us/windows/dev-environment/rust/rust-for-windows
- https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coinitializeex
- https://learn.microsoft.com/en-us/windows/win32/api/roapi/nf-roapi-roinitialize
- https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager?view=winrt-26100 (agile marshaling)
- Scratch crate `%TEMP%\fiore-winapi-check` (outside the repo) for all **[run]** claims.
