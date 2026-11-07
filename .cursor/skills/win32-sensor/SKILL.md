---
name: win32-sensor
description: Step-by-step recipe for implementing or changing a Windows-API sensor in Fiore (media, audio_peak, foreground, fullscreen, clock): windows-crate features, thread and COM init, polling rate, mock trait, debounce, tests, privacy. Use when editing src-tauri/src/sensors/*.rs or adding a FioreEvent source.
---

# Windows sensor recipe

Authority: `docs/reference/windows-crate.md` and `docs/reference/win-apis.md` (verified). Conventions: `docs/conventions.md`. Event names, payloads and detection rules: `docs/fiore-mvp-spec.md` event catalog. Do not invent API signatures; confirm in the reference or the official `windows` crate docs.

Parallel-task rule: edit only your sensor file, its test module, and resources you own. `sensors/mod.rs`, hub registration, and `FioreEvent` are already in final shape from the contract step; need a change -> report a **deviation**, do not edit.

## Steps
1. **Read the catalog entry** for your events: payload, detection, debounce, rate. Implement exactly that.
2. **Split pure logic from OS calls.** Put classification, debounce, thresholds and rect math in pure functions; put OS access behind a small trait (e.g. `trait ForegroundSource { fn current(&self) -> Option<WindowInfo>; }`). The real impl wraps Win32; tests use a fake. Sensors are mocked through traits (`docs/testing.md`).
3. **Cargo features.** The `windows` crate gates each API behind a feature named after its module path. Add only what you use, in `src-tauri/Cargo.toml`, and note which API needs which feature. Typical mappings (confirm in the reference):
   - foreground/window rect: `Win32_UI_WindowsAndMessaging`, `Win32_Foundation`
   - process name (`QueryFullProcessImageNameW`): `Win32_System_Threading`
   - monitor rect: `Win32_Graphics_Gdi`
   - fullscreen state (`SHQueryUserNotificationState`): `Win32_UI_Shell`
   - audio peak (`IAudioMeterInformation`): `Win32_Media_Audio`, `Win32_Media_Audio_Endpoints`, `Win32_System_Com`
   - media sessions (GSMTC): `Media_Control`, `Foundation`
   A missing feature shows as "unresolved import / not found in module"; add the feature, do not hand-roll bindings.
4. **Threading.** One thread (or task) per sensor, owned by `start(&self, tx: Sender<FioreEvent>)`. Initialize COM/WinRT **on that thread** (`CoInitializeEx` with the apartment model the reference prescribes) and uninitialize on exit. Never call blocking WinRT `.get()` on the UI/async-runtime thread. Do not share COM interface pointers across threads.
5. **Polling rate.** Use the catalog rate (e.g. foreground 500 ms, music level ~15 Hz, mood 1/min). Sleep between polls (`recv_timeout`/`sleep`), never busy-loop. Emit **only on change** (plus the periodic `music.level`). Perf budget: whole app idle < 1% CPU, < 60 MB.
6. **Debounce.** Stable-for-N-ms rules (e.g. category must hold 1.5 s, music stopped after 2 s of silence) live in the pure logic with an injected clock, so tests do not sleep.
7. **Errors.** `thiserror` types, `tracing` logs, no `unwrap`/`expect` outside tests, no panics. A failing sensor logs once at `warn`, disables itself, and the app keeps running. Every `unsafe` block gets a `// SAFETY:` comment stating the invariant.
8. **Privacy.** Never read keystroke content. Window titles and track names appear in logs only at `debug` level; at `info` and above log categories and counts only.
9. **Tests.** Rust unit tests for the pure logic (classifier, debounce, mood/season, fullscreen rect) driven by the fake source: one test per acceptance criterion. Real playback or real fullscreen are manual checks via simulators (`scripts/dev/sim/*.ps1`).
10. **Verify and hand off.**
    ```powershell
    pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors,src-tauri/Cargo.toml
    node scripts/dev/emit-event.mjs <event> '<json>'      # frontend reaction without the real sensor
    ```
    Write `.harness/handoff/<task-id>.md` with deviations (shared-file changes you needed) and lesson candidates.

## Common failure signatures
See the `debug-windows-app` skill (COM not initialized, apartment mismatch, missing feature, blocking WinRT call).
