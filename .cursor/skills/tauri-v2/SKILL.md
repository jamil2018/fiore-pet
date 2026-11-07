---
name: tauri-v2
description: Recipes for Tauri v2 work in Fiore: add a Rust command, emit/listen to an event, add a capability permission, add a plugin, change the transparent always-on-top window, and verify. Use when editing src-tauri/ (tauri.conf.json, capabilities, main.rs, window.rs, hub.rs) or calling invoke/listen from src/.
---

# Tauri v2 in Fiore

Authority: `docs/reference/tauri-v2.md` (verified from official docs). If this file and the reference differ, the reference wins; if the reference is silent, check the official docs (WebFetch) before guessing. Many online examples are Tauri **v1**; do not copy them.

Frozen contracts (do not edit in a parallel task; report a deviation): `src-tauri/src/events.rs` (`FioreEvent`), `hub.rs` registration, debug-command interface, `src/events.ts`. The hub emits to the frontend on event name `fiore://event`.

## Add a command
1. Rust (your owned file): `#[tauri::command] fn name(args) -> Result<T, String>` (serializable args/return; use a `thiserror` error mapped with `.map_err(|e| e.to_string())`).
2. Register in the builder's `invoke_handler(tauri::generate_handler![...])`. That list is a shared file in `main.rs`; if you do not own it, report a deviation.
3. Frontend: `import { invoke } from '@tauri-apps/api/core'` (v2 path; not `@tauri-apps/api/tauri`). Arg keys are camelCase on the JS side.
4. Allow it: app-defined commands are allowed by default; plugin and core APIs need a capability permission (below).

## Emit and listen
- Rust: `use tauri::Emitter;` then `app.emit("fiore://event", &payload)?` (payload `Serialize + Clone`). `Emitter`/`Manager`/`Listener` are traits in v2; a missing import is the usual "method not found" error.
- Frontend: `import { listen } from '@tauri-apps/api/event'`; `const un = await listen<T>('fiore://event', e => e.payload)`; keep `un` and call it on teardown.
- Event names may contain only alphanumerics, `-`, `/`, `:`, `_`.
- Sensors never touch the webview directly; they send `FioreEvent` to the hub, which emits.

## Capabilities (permissions)
- Files: `src-tauri/capabilities/*.json` with `identifier`, `windows` (window labels), `permissions` array.
- JS window calls need explicit permission, e.g. `core:window:allow-set-position`, `core:window:allow-show`, `core:window:allow-hide`, `core:event:default`. Denied calls fail at runtime with a "not allowed ... Permissions associated with this command" message naming the permission to add.
- Add the **minimum** permission; avoid `core:default` wildcards beyond what the window needs. Identifiers: confirm in `docs/reference/tauri-v2.md`.

## Add a plugin
1. `cargo add tauri-plugin-<name>` in `src-tauri/`; JS side `npm i @tauri-apps/plugin-<name>` if it has a frontend API.
2. Register: `.plugin(tauri_plugin_<name>::init(...))` in the builder. Single-instance must be registered **first**.
3. Add its permissions to the capability file.
4. Known Fiore plugins: single-instance, autostart (Phase 3).

## Window and tray (Fiore)
- `tauri.conf.json` -> `app.windows[]`: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, small fixed size. Move with `setPosition` (use `PhysicalPosition`/`LogicalPosition` from `@tauri-apps/api/dpi`; mind DPI scaling).
- Current window: `getCurrentWindow()` from `@tauri-apps/api/window`.
- Tray needs the `tray-icon` Cargo feature on `tauri`; menu items "Show/Hide" and "Quit".
- Transparent window appearing white/black: page/body background must be `transparent`, no default Vite background.

## Verify
```powershell
pwsh scripts/check.ps1 -Tier fast -Scope src-tauri,src      # fmt, clippy, tsc, tests
pwsh scripts/check.ps1 -Tier full                           # adds tauri build
npm run tauri dev                                            # real run; logs: see debug-windows-app skill
npm run dev:mock                                             # browser-only UI with fake bridge
```
Capability or config mistakes only show at runtime or in `tauri build`; fast tier will not catch them. For behavior without real conditions inject events: `node scripts/dev/emit-event.mjs <event> [json]`.
