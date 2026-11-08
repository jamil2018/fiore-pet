# Codemap

Purpose: one line per module (path: responsibility, key types). Explorers read this first; executors/integration update it when modules are added.
last-verified: 2026-11-08

Status tags: `[planned W<wave>]` = not yet created, owned by that wave's contract/task; the tag is removed when the file lands. `[stub W1.0, fill <task>]` = file exists with a frozen signature and a no-op body. `docs-check` path-existence checks must skip `[planned ...]` entries.
Harness files (agents, rules, skills, hooks, scripts, evals) are indexed in `docs/harness/README.md`, not here.

## Rust backend (`src-tauri/`)
- `src-tauri/Cargo.toml`: crate deps, `windows` feature flags, clippy lints.
- `src-tauri/tauri.conf.json`: window (transparent, frameless, always-on-top, skip-taskbar), bundle/NSIS config.
- `src-tauri/capabilities/default.json`: minimal Tauri v2 permissions.
- `src-tauri/src/main.rs`: binary entry; calls `fiore_lib::run()`.
- `src-tauri/src/lib.rs`: composition root; plugins, logging, window, hub, commands. Contract file.
- `src-tauri/src/events.rs`: `FioreEvent` serde enum (all catalog events), payload types, serde tests. Contract file.
- `src-tauri/src/hub.rs`: `EventHub`; registers sensors, spawns threads, dedupes, emits `fiore://event`, sends `state.snapshot`. Contract file.
- `src-tauri/src/window.rs`: window setup, tray (Show/Hide, Start with Windows, Quit), single instance, initial placement (not a position command; wander uses `bridge.window.setPosition`).
- `src-tauri/src/logging.rs`: `tracing` JSON lines to `logs/fiore-dev.log`, `RUST_LOG` filter.
- `src-tauri/src/debug.rs`: dev-only `emit_debug_event` command and loopback TCP injector (event injection for `emit-event.mjs`, debug panel).
- `src-tauri/src/window/autostart.rs`: tray "Start with Windows" toggle (`tauri-plugin-autostart`).
- `src-tauri/src/sensors/mod.rs`: `Sensor` trait and registration of all 5 sensors. Contract file.
- `src-tauri/src/sensors/win.rs`: shared Win32 helpers (`WinRtGuard`, `ComGuard`, `foreground`, `is_own_pid`). Contract file. `#[cfg(windows)]`.
- `src-tauri/src/sensors/media.rs`: GSMTC session -> `music.started`, `music.track_changed`, `music.stopped` (2 s stop debounce).
- `src-tauri/src/sensors/audio_peak.rs`: `IAudioMeterInformation` peak -> `music.level` at ~15 Hz while playing.
- `src-tauri/src/sensors/foreground.rs`: 500 ms foreground poll, classifier, 1.5 s hold -> `app.category_changed`.
- `src-tauri/src/sensors/fullscreen.rs`: `SHQueryUserNotificationState` + monitor-rect compare -> `fullscreen.entered`/`exited`.
- `src-tauri/src/sensors/clock.rs`: mood (1/min) and season (startup, midnight), `FIORE_FAKE_CLOCK`, hemisphere flag -> `time.mood_changed`, `season.changed`.
- `src-tauri/resources/app-categories.json`: process-name and title-keyword rules per category.

## Frontend (`src/`)
- `src/main.ts`: entry; picks bridge (tauri/mock), builds engine, animator, mover.
- `src/events.ts`: TS union mirroring `FioreEvent`. Contract file.
- `src/bridge/index.ts`: `Bridge` interface and selection (`tauri` vs `mock`).
- `src/bridge/tauri.ts`: listens to `fiore://event`, wraps debug command.
- `src/bridge/mock.ts`: fake bridge for browser `dev:mock`, scripted/manual events.
- `src/behavior/types.ts`: engine input/output types (`Resolution`, layer/animation name constants, reaction shape). Contract file.
- `src/behavior/engine.ts`: pure priority/layering resolver.
- `src/behavior/golden.test.ts`: golden replay runner.
- `src/behavior/golden/*.json`: golden replay cases (see `docs/testing.md`).
- `src/behavior/golden/events/*.json`: shared serde fixtures, one file per catalog event.
- `src/behavior/reactions/index.ts`: reaction registry with a stub per feature. Contract file.
- `src/behavior/reactions/fullscreen.ts`: hide, appear, and the hidden tier stay engine-owned.
- `src/behavior/reactions/petting.ts`: stroke facing at the petting tier.
- `src/behavior/reactions/activity.ts`: coding `think` pose for 2 s every 20–40 s.
- `src/behavior/reactions/music.ts`: smoothed `music.level` overlay while playing.
- `src/behavior/reactions/mood.ts`: face, speed, stretch, and yawn stay engine-owned.
- `src/behavior/reactions/season.ts`: outfit and twirl stay engine-owned.
- `src/render/animator.ts`: layered sprite animator (canvas, 3x nearest-neighbor, frame timing).
- `src/render/atlas.ts`: loads and merges `public/sprites/<group>.json` atlases, schema validation.
- `src/interaction/mover.ts`: `WindowMover` (wander, `setPosition`).
- `src/interaction/petting.ts`: pointer hover, stroke, and petted detector emitting `pet.*`.
- `src/debug/panel.ts`: dev-only panel that fires fake events.

## Sprites (`public/sprites/`, `<group>.png` + `<group>.json` each)
- `public/sprites/base.*`: body idle, walk, sit, notice, jump. Frozen after the W2.0 contract. Other groups may still reference `base.png`.
- `public/sprites/activity.*`: body code, think, write, browse on `activity.png`; accessories laptop, notepad, tablet on `base.png`.
- `public/sprites/music.*`: body dance, headbob; accessory headphones. Image stays `base.png`.
- `public/sprites/petting.*`: body lean, happy, wag; face happy. Image stays `base.png`.
- `public/sprites/fullscreen.*`: body hide, appear. Image stays `base.png`.
- `public/sprites/outfits.*`: seasonal outfits and body twirl. Image stays `base.png`.
- `public/sprites/faces.*`: mood faces and body stretch, yawn. Image stays `base.png`.

## Dev tools (`scripts/dev/`)
- `scripts/dev/emit-event.mjs`: inject a `FioreEvent` into the running dev app.
- `scripts/dev/sim/start-notepad.ps1`: simulate `writing` activity.
- `scripts/dev/sim/play-test-tone.ps1`: play bundled audio so GSMTC sees media.
- `scripts/dev/sim/test-tone.wav`: 440 Hz tone bundled for `play-test-tone.ps1`.
- `scripts/dev/sim/fullscreen-window.ps1`: simulate a fullscreen window.
- `scripts/dev/sim/set-fake-clock.ps1`: set `FIORE_FAKE_CLOCK` for mood, season, and boundary times.
- `scripts/dev/perf-sample.ps1`: idle CPU% and RAM sampler for `fiore.exe` plus the WebView2 process tree.

## Config (repo root)
- `package.json`, `vite.config.ts`, `tsconfig.json`, `biome.json`, `rustfmt.toml`: tooling configs (`dev`, `dev:mock`, `test`, `build` scripts).
- `index.html`: Vite entry page, canvas mount.
