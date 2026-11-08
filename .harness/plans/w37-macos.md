# macOS sensors

Goal: extend existing catalog reactions to macOS using public native APIs, with explicit consent and Windows regression coverage. Lane L, run w37-macos-20261108, budget 25 calls.

## Ownership and todos
- desktop executor: native/macos/desktop.m, sensors/foreground.rs, sensors/fullscreen.rs, resources/app-categories.json under src-tauri. Implement identity, optional title, geometry/fullscreen hints, bundle rules and deterministic tests.
- media executor: src-tauri/native/macos/media.m and src-tauri/src/sensors/media.rs. Implement authorized, bounded Apple Music/Spotify polling, explicit permission helper, deterministic source/tracker tests.
- audio executor: src-tauri/native/macos/audio.m and src-tauri/src/sensors/audio_peak.rs. Implement opt-in Core Audio taps, finite scalar peaks, cleanup, availability and permission guards, tests.
- orchestrator: shared native header/common.m and Rust macos.rs; module registry, Cargo/build/config/plists, tray controls, docs, CI, harness and integration.

Each executor reads src-tauri/AGENTS.md, relevant sensor/spec sections and role instructions; runs scoped fast, at most two attempts. No executor edits shared contracts. Spec extension and module/build registry changes are reported orchestrator deviations. No new events.

## Frozen ABI
All JSON returns are malloc-owned UTF-8, freed by fiore_macos_free. NULL is fatal bridge failure. status is ok/unavailable/denied/error. No raw exception/title/track text in error strings. Desktop fields: pid(nullable integer), bundle_id(nullable string), title(nullable string), fullscreen(nullable boolean), is_self(boolean). Media fields: playing(boolean), title/artist/source_app(strings). Rust helper macos::snapshot<T: DeserializeOwned>(pointer) returns Result<T, SensorError> and frees memory.

Desktop exports char *fiore_macos_desktop_snapshot(void), void fiore_macos_request_accessibility(void). Media exports char *fiore_macos_media_snapshot(void), int fiore_macos_request_media_permission(int player), player 0 Music/1 Spotify, result 0 granted/1 absent/2 denied/3 error. Audio exports void *fiore_macos_peak_open(void), int fiore_macos_peak_read(void*,float*) (0 sample/1 transient/-1 fatal), void fiore_macos_peak_close(void*), int fiore_macos_audio_enabled(void), void fiore_macos_set_audio_enabled(int), int fiore_macos_audio_supported(void). Audio setting persists in NSUserDefaults, defaults false. Tray calls permission requests explicitly; audio can start only after opt-in while playing.

## Validation
Scoped fast per executor; Windows full gate; macOS native clippy/tests and universal app build in feature CI. Judge once after integration. Keep pet closed. Never overwrite published v0.2.0. Headless CI cannot validate TCC prompts, live players or real output devices: document manual Mac checklist.

## Risks / exclusions
No private MediaRemote, microphone capture, keystrokes or browser extensions. No promise of arbitrary-player track metadata. Geometry fallback cannot perfectly distinguish borderless/maximized windows with auto-hidden system UI. Core Audio taps require macOS 14.2+; other sensors retain older supported macOS compatibility. Signing/notarization credentials are not available.
