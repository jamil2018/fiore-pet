# Codemap

Purpose: one line per module (path: responsibility, key types). Explorers read this first; executors/integration update it when modules are added.
last-verified: 2026-11-07

Status tags: `[planned W<wave>]` = not yet created, owned by that wave's contract/task; the tag is removed when the file lands. `docs-check` path-existence checks must skip `[planned ...]` entries.
Harness files (agents, rules, skills, hooks, scripts, evals) are indexed in `docs/harness/README.md`, not here.

## Rust backend (`src-tauri/`)
- `src-tauri/Cargo.toml`: crate deps, `windows` feature flags, clippy lints. [planned W1.0]
- `src-tauri/tauri.conf.json`: window (transparent, frameless, always-on-top, skip-taskbar), bundle/NSIS config. [planned W1.0]
- `src-tauri/capabilities/default.json`: minimal Tauri v2 permissions. [planned W1.0]
- `src-tauri/src/main.rs`: app entry, builder, plugin setup, hub start. [planned W1.0]
- `src-tauri/src/events.rs`: `FioreEvent` serde enum (all catalog events), payload types, serde tests. Contract file. [planned W1.0]
- `src-tauri/src/hub.rs`: `EventHub`; registers sensors, spawns threads, dedupes, emits `fiore://event`, sends `state.snapshot`. Contract file. [planned W1.0]
- `src-tauri/src/window.rs`: window setup, tray (Show/Hide, Quit), single instance, set-position command. [planned W1.1]
- `src-tauri/src/logging.rs`: `tracing` JSON lines to `logs/fiore-dev.log`, `RUST_LOG` filter. [planned W1.1]
- `src-tauri/src/debug.rs`: dev-only `emit_debug_event` command (event injection for `emit-event.mjs`, debug panel). [planned W1.0]
- `src-tauri/src/autostart.rs`: autostart toggle wired to tray. [planned W3.0]
- `src-tauri/src/sensors/mod.rs`: `Sensor` trait, registration of all 5 sensors (stubs from W1.0). Contract file. [planned W1.0]
- `src-tauri/src/sensors/media.rs`: GSMTC session -> `music.started`, `music.track_changed`, `music.stopped` (2 s stop debounce). [planned W2.0 `w20-music`]
- `src-tauri/src/sensors/audio_peak.rs`: `IAudioMeterInformation` peak -> `music.level` at ~15 Hz while playing. [planned W2.0 `w20-music`]
- `src-tauri/src/sensors/foreground.rs`: 500 ms foreground poll, classifier, 1.5 s hold -> `app.category_changed`. [planned W2.0 `w20-app-category`]
- `src-tauri/src/sensors/fullscreen.rs`: `SHQueryUserNotificationState` + monitor-rect compare -> `fullscreen.entered`/`exited`. [planned W2.0 `w20-fullscreen`]
- `src-tauri/src/sensors/clock.rs`: mood (1/min) and season (startup, midnight), `FIORE_FAKE_CLOCK`, hemisphere flag -> `time.mood_changed`, `season.changed`. [planned W2.0 `w20-mood-season`]
- `src-tauri/resources/app-categories.json`: process-name and title-keyword rules per category. [planned W2.0 `w20-app-category`]

## Frontend (`src/`)
- `src/main.ts`: entry; picks bridge (tauri/mock), builds engine, animator, mover. [planned W1.0]
- `src/events.ts`: TS union mirroring `FioreEvent`. Contract file. [planned W1.0]
- `src/bridge/index.ts`: `Bridge` interface and selection (`tauri` vs `mock`). [planned W1.0]
- `src/bridge/tauri.ts`: listens to `fiore://event`, wraps debug command. [planned W1.0]
- `src/bridge/mock.ts`: fake bridge for browser `dev:mock`, scripted/manual events. [planned W1.1 `w11-devtools`]
- `src/behavior/types.ts`: engine input/output types (`Resolution`, layer/animation name constants, `EngineState`). Contract file. [planned W1.0]
- `src/behavior/engine.ts`: pure priority/layering resolver. [planned W1.1 `w11-engine`]
- `src/behavior/golden.test.ts`: golden replay runner. [planned W1.1 `w11-engine`]
- `src/behavior/golden/*.json`: golden replay cases (see `docs/testing.md`). [planned W1.1]
- `src/behavior/reactions/index.ts`: reaction registry with a stub per feature. Contract file. [planned W1.0]
- `src/behavior/reactions/fullscreen.ts`: hide/appear reducer. [planned W2.0 `w20-fullscreen`]
- `src/behavior/reactions/petting.ts`: petting reducer (look, lean, happy, wag). [planned W2.0 `w20-petting`]
- `src/behavior/reactions/activity.ts`: coding/writing/browsing reducer. [planned W2.0 `w20-app-category`]
- `src/behavior/reactions/music.ts`: notice, dance/headbob, jump, bubble reducer. [planned W2.0 `w20-music`]
- `src/behavior/reactions/mood.ts`: mood -> face and speed, stretch/yawn. [planned W2.0 `w20-mood-season`]
- `src/behavior/reactions/season.ts`: season -> outfit, twirl. [planned W2.0 `w20-mood-season`]
- `src/render/animator.ts`: layered sprite animator (canvas, 3x nearest-neighbor, frame timing). [planned W1.1 `w11-render`]
- `src/render/atlas.ts`: loads and merges `public/sprites/<group>.json` atlases, schema validation. [planned W1.0]
- `src/interaction/mover.ts`: `WindowMover` (wander, `setPosition`). [planned W1.1 `w11-window`]
- `src/interaction/petting.ts`: pointer hover/stroke/petted detector emitting `pet.*`. [planned W2.0 `w20-petting`]
- `src/debug/panel.ts`: dev-only panel that fires fake events. [planned W1.1 `w11-devtools`]

## Sprites (`public/sprites/`, `<group>.png` + `<group>.json` each)
- `public/sprites/base.*`: idle, walk, sit, notice, jump, dance base animations. [planned W1.1 `w11-render`]
- `public/sprites/activity.*`: code, think, write, browse, props (laptop, notepad, tablet). [planned W2.0 `w20-app-category`]
- `public/sprites/music.*`: dance, headbob, headphones. [planned W2.0 `w20-music`]
- `public/sprites/petting.*`: lean, happy, wag, hearts. [planned W2.0 `w20-petting`]
- `public/sprites/fullscreen.*`: hide, appear, dust puff. [planned W2.0 `w20-fullscreen`]
- `public/sprites/outfits.*`: seasonal outfits, twirl. [planned W2.0 `w20-mood-season`]
- `public/sprites/faces.*`: mood faces, stretch, yawn. [planned W2.0 `w20-mood-season`]

## Dev tools (`scripts/dev/`)
- `scripts/dev/emit-event.mjs`: inject a `FioreEvent` into the running dev app. [planned W1.1 `w11-devtools`]
- `scripts/dev/sim/start-notepad.ps1`: simulate `writing` activity. [planned W1.1 `w11-devtools`]
- `scripts/dev/sim/play-test-tone.ps1`: play bundled audio so GSMTC sees media. [planned W1.1 `w11-devtools`]
- `scripts/dev/sim/fullscreen-window.ps1`: simulate a fullscreen window. [planned W1.1 `w11-devtools`]

## Config (repo root)
- `package.json`, `vite.config.ts`, `tsconfig.json`, `biome.json`, `rustfmt.toml`: tooling configs (`dev`, `dev:mock`, `test`, `build` scripts). [planned W1.0]
- `index.html`: Vite entry page, canvas mount. [planned W1.0]
