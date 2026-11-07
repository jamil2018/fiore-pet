# Tauri v2 reference (Fiore)

Purpose: verified Tauri v2 facts the executor needs (window, capabilities, events, tray, plugins, v1 pitfalls) so nobody guesses these APIs.
last-verified: 2026-11-07 (against v2.tauri.app and docs.rs `tauri` 2.12.5; see Sources)

Legend: **[doc]** = stated by the official page cited in Sources. **[Fiore]** = our recommendation or inference; not stated by the docs, so check it with a manual run before relying on it.

## 1. Project shape (v2)

- **[doc]** Config is `src-tauri/tauri.conf.json`. Top-level keys: `productName`, `version`, `identifier` (required), `mainBinaryName`, `build`, `app`, `bundle`, `plugins`. Platform overrides merge in from `tauri.windows.conf.json`.
- **[doc]** Rust entry split: logic in `src-tauri/src/lib.rs` (`#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`), and `main.rs` only calls it:

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { app_lib::run(); }   // `app_lib` = [lib] name in Cargo.toml
```

- **[doc]** Vite wiring (`tauri.conf.json` `build`): `devUrl: "http://localhost:5173"`, `frontendDist: "../dist"`, `beforeDevCommand: "npm run dev"`, `beforeBuildCommand: "npm run build"`. In `vite.config.ts`: `clearScreen: false`, `server.port` equal to `devUrl` port with `strictPort: true`, `server.watch.ignored: ['**/src-tauri/**']`, `envPrefix: ['VITE_', 'TAURI_ENV_*']`, and for Windows `build.target: 'chrome105'` (WebView2 is Chromium).
- **[doc]** Dev-only Rust code: `#[cfg(dev)]` / `tauri::is_dev()` (true only under `tauri dev`); `#[cfg(debug_assertions)]` (true for `tauri dev` and `tauri build --debug`). Devtools work in debug builds; release builds need the `devtools` Cargo feature. `Ctrl+Shift+I` opens the inspector on Windows. PowerShell backtrace: `$env:RUST_BACKTRACE=1; tauri dev`.

## 2. Transparent, frameless, always-on-top window

Declare the pet window in `app.windows[]` (all keys below are `WindowConfig` fields **[doc]**):

```json
{
  "app": {
    "security": { "csp": null },
    "windows": [{
      "label": "main",
      "title": "Fiore",
      "width": 96, "height": 96,
      "transparent": true,
      "decorations": false,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "shadow": false,
      "resizable": false,
      "maximizable": false,
      "minimizable": false,
      "focus": false,
      "visible": false,
      "noRedirectionBitmap": true
    }]
  }
}
```

Facts behind each key:

| Key | Fact |
|---|---|
| `transparent` | **[doc]** "Whether the window is transparent." `windowEffects` requires it. |
| `decorations` | **[doc]** `false` removes borders and bars (default `true`). |
| `alwaysOnTop` | **[doc]** Window stays above other windows. Also settable at runtime (`setAlwaysOnTop`, needs `core:window:allow-set-always-on-top`). |
| `skipTaskbar` | **[doc]** `true` hides the taskbar icon on Windows and Linux. |
| `shadow` | **[doc]** On Windows, `shadow: true` gives an undecorated window a 1 px white border (and rounded corners on Win 11); `false` has no effect on a *decorated* window. **[Fiore]** keep `false` for the pet so no border shows. |
| `noRedirectionBitmap` | **[doc]** Sets `WS_EX_NOREDIRECTIONBITMAP`; "can avoid the white flash" before the webview renders in a transparent window. Windows only. |
| `focus` / `focusable` | **[doc]** `focus: false` = not initially focused; `focusable: false` = window cannot take focus. **[Fiore]** unverified whether a non-focusable window still receives clicks/hover in WebView2; test before enabling `focusable: false` (petting needs pointer events). |
| `visible` | **[doc]** Initial visibility (default `true`). **[Fiore]** start hidden and `show()` after the first frame to avoid a flash. |
| `width`/`height` | **[doc]** Logical pixels (defaults 800x600). Size above is an example, not a decision; the spec and `architecture.md` own the real size. |
| `backgroundThrottling` | **[doc]** Unsupported on Windows. **[Fiore]** do not rely on the webview pausing timers when hidden; the render loop must pause itself while the pet is hidden (fullscreen reaction). |

- **[Fiore]** A transparent window also needs a transparent page: set `html, body { background: transparent; }` in the frontend CSS (standard web behavior, not stated in the Tauri pages above).
- **[doc]** `macOSPrivateApi` is a no-op from Tauri 2.12.1 on and is irrelevant on Windows; do not add it.
- **[doc]** `useHttpsScheme` (Windows): production origin is `http://tauri.localhost` by default; changing it between releases resets localStorage/IndexedDB/cookies. Keep the default and never persist state in web storage that must survive a scheme change; **[Fiore]** persist settings via Rust.

### Moving and click-through at runtime

- **[doc]** JS (`@tauri-apps/api/window`): `getCurrentWindow().setPosition(new LogicalPosition(x, y))` (or `PhysicalPosition`), `outerPosition()`, `setIgnoreCursorEvents(bool)`, `startDragging()`, `setAlwaysOnTop`, `setSkipTaskbar`, `setSize`, `show()`, `hide()`. Free functions: `cursorPosition()` (physical px, relative to the desktop top-left; can be negative on multi-monitor), `currentMonitor()`, `primaryMonitor()`, `availableMonitors()`. `Monitor` has `position`, `size`, `scaleFactor`, `workArea`.
- **[doc]** Units: window creation options (`x`, `y`, `width`, `height`) are **logical**; `Monitor.position` and `cursorPosition()` are **physical**. Convert with `scaleFactor` (`monitor.position.toLogical(monitor.scaleFactor)`) or the pet jumps on high-DPI monitors.
- **[doc]** Rust (`WebviewWindow`, docs.rs 2.12.5): `set_ignore_cursor_events`, `set_position`, `cursor_position`, `set_always_on_top`, `set_skip_taskbar`, `set_shadow`, `set_focusable`, `show`, `hide`, `start_dragging`, `outer_position`, `scale_factor`, `current_monitor`, `primary_monitor` all exist.
- **[doc]** `data-tauri-drag-region` only applies to the element it is set on, not its children. `startDragging()` is the manual alternative. **[Fiore]** the pet moves via `setPosition` (WindowMover), so drag regions are optional.
- **[Fiore]** With `setIgnoreCursorEvents(true)` the webview gets no mouse events, so it cannot detect hover to turn click-through off. Hit-test from Rust by polling `cursor_position()` against the pet's rect (low rate), or leave click-through off and keep the window sprite-sized.

## 3. Capabilities and permissions

- **[doc]** Capabilities are JSON/TOML files in `src-tauri/capabilities/`. All files there are enabled automatically; once `app.security.capabilities` lists identifiers in `tauri.conf.json`, **only** those are used.
- **[doc]** A capability maps `windows` (by **label**, not title) to `permissions`. Plugin/core commands are blocked unless a permission allows them. Windows in several capabilities get the merged permissions.
- **[doc]** App commands registered with `invoke_handler` are allowed for all windows by default; restrict with `AppManifest::commands` in `build.rs` only if needed.
- **[doc]** Capabilities guard the **frontend** boundary. They do not protect against anything written in Rust. **[Fiore]** so Rust-side calls (`window.set_position(...)` in `window.rs`) need no permission; only JS calls do.
- **[doc]** Use `"$schema": "../gen/schemas/desktop-schema.json"` for IDE completion (generated by `tauri-build`).

`core:default` bundles: `core:app`, `core:event`, `core:image`, `core:menu`, `core:path`, `core:resources`, `core:tray`, `core:webview`, `core:window` (all `:default`). **[doc]**

**Pitfall (verified):** `core:window:default` is read-mostly (queries like `outer-position`, `current-monitor`, `cursor-position`, `is-visible`, `is-always-on-top`, `scale-factor`). It does **not** include the mutating calls the pet needs. Each of these must be added explicitly **[doc]**: `core:window:allow-set-position`, `allow-set-ignore-cursor-events`, `allow-set-always-on-top`, `allow-set-skip-taskbar`, `allow-set-size`, `allow-show`, `allow-hide`, `allow-start-dragging`, `allow-set-focus`, `allow-set-shadow`.

`core:event:default` already covers `listen`, `unlisten`, `emit`, `emit-to`, so listening needs no extra permission. **[doc]**

Example `src-tauri/capabilities/default.json` **[Fiore: starting point; trim to what the JS actually calls]**:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Pet window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-position",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-show",
    "core:window:allow-hide"
  ]
}
```

Failure signature **[Fiore]**: a JS window call that rejects with a "not allowed" / ACL error in the webview console means a missing `allow-*` permission, not a code bug. Add the permission named after the command (snake_case command to kebab-case permission).

## 4. Commands, state, events

### Commands **[doc]**
- `#[tauri::command] fn x(...)`, registered with `.invoke_handler(tauri::generate_handler![x])`. Names are unique across modules.
- In `lib.rs` a command must **not** be `pub`; in a separate module it must be `pub` and is listed as `commands::x`.
- JS: `import { invoke } from '@tauri-apps/api/core'`. Arguments are a JSON object with **camelCase** keys (`invoke('x', { invokeMessage })` for `invoke_message`) unless `#[tauri::command(rename_all = "snake_case")]`.
- A borrowed-arg `async` command (e.g. `State<'_, T>`) must return `Result`.

### State **[doc]**
- `app.manage(Mutex::new(AppState::default()))` in `setup`; read with `State<'_, Mutex<AppState>>` or `app_handle.state::<Mutex<AppState>>()`.
- No `Arc` needed (Tauri wraps state). Wrong `State<T>` type is a **runtime** error, not a compile error; `Manager::state()` on an unmanaged type panics. Use a type alias to avoid mismatches. Use a std `Mutex` unless a guard must be held across `.await`.

### Events (Rust to frontend) **[doc]**
- Rust: `use tauri::{AppHandle, Emitter};` then `app.emit("name", payload)` (global, to all listeners), `emit_to(label, ...)`, `emit_filter(...)`. Payload: `Serialize + Clone`; use `#[serde(rename_all = "camelCase")]` for field names.
- Frontend: `import { listen, once, emit } from '@tauri-apps/api/event'`. `listen` returns `Promise<UnlistenFn>`.
- **Event names** must contain only alphanumerics, `-`, `/`, `:`, `_`. So `fiore://event` is valid (as is built-in `tauri://move`), but a dotted name such as `music.started` is **not**. **[Fiore]** consequence: send every `FioreEvent` as the payload of the single channel `fiore://event`, with the `dot.case` name inside the payload (serde `tag`), never as the Tauri event name.
- The event system is "not designed for low latency or high throughput"; payloads are JSON strings. Channels (`tauri::ipc::Channel`, `new Channel<T>()` + `invoke`) are the ordered, fast path. **[Fiore]** `music.level` at ~15 Hz with a tiny payload is fine on events; switch to a `Channel` only if profiling shows a problem.
- Pitfalls **[doc]**:
  - `await listen(...)` before storing/calling `unlisten`; calling it on the un-awaited promise does nothing (or removes the handler immediately).
  - Async listeners can process rapid events out of order. **[Fiore]** make the bridge handler synchronous (push into the engine queue) and do async work afterwards.
  - Webview-targeted emits (`emit_to`) are not seen by plain `listen`; use `listen_any` (Rust) for catch-all. JS `listen()` already behaves like `listen_any`.
  - Listeners are removed automatically when the window is destroyed, but still `unlisten` when a component/scope ends.
- Race **[Fiore]**: a Rust `setup` hook can emit before the webview has called `listen`, so those early events are lost. The hub's `state.snapshot` must be (re)sent after the frontend signals ready (invoke a `frontend_ready` command, or re-emit on request), not once at process start.
- Testing **[doc]**: `@tauri-apps/api/mocks` `mockIPC(handler, { shouldMockEvents: true })` (since 2.7.0) fakes `emit`/`listen`; `emitTo`/`emit_filter` are **not** supported in the mock. Call `clearMocks()` after each test. jsdom needs a `crypto.getRandomValues` shim. Also see `mockWindows()`.

## 5. System tray **[doc]**

- Cargo: `tauri = { version = "2", features = ["tray-icon"] }` (v1 feature was `system-tray`).
- Rust (`tauri::tray::TrayIconBuilder`, `tauri::menu::{Menu, MenuItem}`):

```rust
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};

let show = MenuItem::with_id(app, "toggle", "Show/Hide", true, None::<&str>)?;
let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&show, &quit])?;
let _tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .show_menu_on_left_click(true)   // default: menu opens on left AND right click
    .on_menu_event(|app, event| match event.id.as_ref() {
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
```

- Tray click events: `.on_tray_icon_event(|tray, event| ...)` with `TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }`; use `tray.app_handle()`. On Linux tray events are unsupported (irrelevant for Fiore).
- Keep the returned `TrayIcon` alive. **[Fiore]** (standard Rust drop semantics, not in the page) the tray disappears if the value is dropped; store it in managed state or leak it deliberately.
- A tray created in Rust needs no capability. JS `TrayIcon.new` needs `core:tray:default` (already in `core:default`).
- Menu event ids are the string passed to `with_id`.

## 6. Plugins

General **[doc]**: Rust crate `tauri-plugin-<name>` + npm `@tauri-apps/plugin-<name>` (v1 plugins were `tauri-plugin-<name>-api`). Register with `.plugin(...)`. Plugin commands need capability permissions (`<name>:allow-...` or `<name>:default`).

| Plugin | Setup | Permissions |
|---|---|---|
| `single-instance` | `cargo add tauri-plugin-single-instance --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`. `.plugin(tauri_plugin_single_instance::init(\|app, args, cwd\| { ... }))` | None (no JS API). |
| `autostart` | `cargo add tauri-plugin-autostart --target 'cfg(any(...))'`. `.plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--flag"])))`; Rust: `use tauri_plugin_autostart::ManagerExt; app.autolaunch().enable()/disable()/is_enabled()`. JS: `enable()`, `disable()`, `isEnabled()` from `@tauri-apps/plugin-autostart`. | `autostart:default` = `allow-enable`, `allow-disable`, `allow-is-enabled` (needed for JS only). |

- **[doc]** The single-instance plugin **must be the first plugin registered**. Its closure runs in the *first* instance when a second launch is blocked; to surface the window: `app.get_webview_window("main").unwrap().set_focus()`. **[Fiore]** for the pet, show the window instead (`show()`), since it may be hidden.
- **[doc]** Both pages show `#[cfg(desktop)]` gating and registration in `setup` via `app.handle().plugin(...)`. **[Fiore]** register single-instance on the `Builder` before anything else so it is first, and keep both plugin crates under `cfg(desktop)` target deps.
- **[doc]** Both plugin pages state a minimum Rust version of 1.90.
- Not needed for Fiore MVP: `shell`, `fs`, `dialog`, `http`, `notification`, `global-shortcut`. Do not add plugins or permissions "just in case"; each adds an attack surface and a capability line.

## 7. v1 to v2 pitfalls (migration guide plus the v2 pages above)

If an example or memory says v1, translate. Rows marked (v2 pages) come from the v2 examples rather than the migration guide's change list:

| v1 | v2 |
|---|---|
| `tauri.conf.json` `tauri` key | `app` |
| `tauri > allowlist` | removed; capability files + permissions |
| `tauri > systemTray` | `app > trayIcon`; Rust `SystemTray*` replaced by `tauri::tray::TrayIconBuilder` + `tauri::menu` |
| Cargo feature `system-tray` | `tray-icon` |
| `package > productName/version` | top-level `productName`/`version`; `identifier` top-level; add `mainBinaryName` (binary no longer auto-renamed) |
| `build > devPath` / `distDir` | `build > devUrl` / `frontendDist` |
| `@tauri-apps/api/tauri` | `@tauri-apps/api/core` (`invoke`) |
| `@tauri-apps/api/window` `WebviewWindow` | `@tauri-apps/api/webviewWindow` (`getCurrentWebviewWindow`); `getCurrentWindow()` from `@tauri-apps/api/window` |
| `appWindow` import | `getCurrentWindow()` (v2 pages) |
| Rust `Window`, `WindowBuilder`, `WindowUrl`, `get_window` | `WebviewWindow`, `WebviewWindowBuilder`, `WebviewUrl`, `get_webview_window` |
| `listen_global` | `listen_any`; `emit` now reaches **all** listeners; new `emit_to`/`emitTo`; `emit_filter` filters on `EventTarget` |
| `emit`/`listen` on app/window handles | need `use tauri::Emitter` / `use tauri::Listener` in scope (v2 pages) |
| `api::*` modules (dialog, fs, http, shell, process, ...) | separate plugins (`@tauri-apps/plugin-*`, `tauri-plugin-*`) |
| `Builder::on_menu_event` | `App::on_menu_event` / `AppHandle::on_menu_event`; tray: `TrayIconBuilder::on_menu_event` |
| `fileDropEnabled` | `dragDropEnabled` |
| `tauri.localhost` is `https` on Windows | `http://tauri.localhost`; storage resets unless `useHttpsScheme: true` |
| env `TAURI_PLATFORM`, `TAURI_DEBUG`, ... | `TAURI_ENV_PLATFORM`, `TAURI_ENV_DEBUG`, ... |
| single `main.rs` | `lib.rs` (`run()`) + thin `main.rs` |

`npm run tauri migrate` automates part of this, but the guide says it is not a substitute for reading it. Fiore starts on v2, so it is a lookup table only.

## 8. Fiore checklist for any Tauri change

1. New JS-to-window call? Add the exact `core:window:allow-*` permission (section 3); `core:window:default` will not cover it.
2. New plugin? crate (cfg desktop) + npm package + `.plugin(...)` (single-instance first) + permission line only if JS uses it.
3. New event? Do not name Tauri events with dots; extend `FioreEvent` and the single `fiore://event` payload instead.
4. Units: logical vs physical (section 2).
5. After editing `tauri.conf.json` or capabilities, restart `tauri dev` **[Fiore]** (config is read at build/start). The `$schema` files in `src-tauri/gen/schemas` are produced by `tauri-build` **[doc]**.

## Sources

Fetched 2026-11-07. Capability and event pages were checked against their "Last updated" stamps (capabilities Nov 5 2026, calling-frontend Sep 9 2026).

- https://v2.tauri.app/reference/config/ (WindowConfig, AppConfig, top-level keys)
- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/reference/acl/core-permissions/
- https://v2.tauri.app/learn/window-customization/
- https://v2.tauri.app/reference/javascript/api/namespacewindow/
- https://v2.tauri.app/reference/javascript/api/namespaceevent/ (event-name character rule)
- https://v2.tauri.app/develop/calling-frontend/
- https://v2.tauri.app/develop/calling-rust/
- https://v2.tauri.app/develop/state-management/
- https://v2.tauri.app/learn/system-tray/
- https://v2.tauri.app/plugin/single-instance/
- https://v2.tauri.app/plugin/autostart/
- https://v2.tauri.app/start/migrate/from-tauri-1/
- https://v2.tauri.app/start/frontend/vite/
- https://v2.tauri.app/develop/debug/
- https://v2.tauri.app/develop/tests/mocking/
- https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html (method existence, version 2.12.5)

Not verifiable from the docs (marked **[Fiore]** above): transparent page CSS, non-focusable window input behavior, tray lifetime, event-before-listen race handling.
