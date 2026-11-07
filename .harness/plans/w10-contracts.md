# Wave plan: w10

Purpose: W1.0 contract step (serial critical path): Tauri v2 + Vite TS scaffold and every frozen contract W1.1/W2.0 fill against.
last-verified: 2026-11-08

- Wave id: `w10`
- Phase: P1
- Contract frozen at: checkpoint commit after judge PASS (tag later as part of `p1-foundation`)
- Isolation: one worktree, branch `task/w10-contracts`
- Concurrency cap: 1 (serial; single executor, run in up to 3 batches)

## Goal
Scaffold a buildable Tauri v2 + Vite TS app with a transparent pet window, and create every shared/contract file in final shape (events, Sensor trait, hub, debug command, reaction registry, engine types, atlas schema + loader) plus signature-frozen stubs for every later-wave file, so W1.1/W2.0 tasks only fill files they own. Make `check.ps1` fast/full run real Rust + TS projects green.

## Tasks

### `w10-contracts`
- Lane: M
- Budget: 10 calls
- Goal: scaffold + frozen contracts + stubs + check wiring (plan below)
- owns (contract owner: this step is the only one allowed to touch shared files):
  - `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`, `index.html`, `rustfmt.toml`, `.gitignore`
  - `src-tauri/**` (Cargo.toml, Cargo.lock, build.rs, tauri.conf.json, capabilities/, icons/, src/**)
  - `src/**` (events.ts, main.ts, bridge/, behavior/types.ts, behavior/engine.ts stub, behavior/reactions/**, behavior/golden/events/**, render/**, interaction/** stubs, debug/** stub)
  - `scripts/check.ps1`
  - `docs/codemap.md`, `docs/architecture.md` (Contracts + Sensor/hub sections only), `docs/reference/sprite-atlas.md`
- reads:
  - `docs/fiore-mvp-spec.md`, `docs/conventions.md`, `docs/testing.md`, `docs/reference/tauri-v2.md`, `docs/reference/sprite-atlas.md`, `src/AGENTS.md`, `src-tauri/AGENTS.md`, `scripts/harness/docs-check.mjs`, `.github/workflows/check.yml`
- Depends on: none (W0.2 done)
- Task packet: `.harness/plans/w10-contracts.md`

## Shared files (contract owner / integration only)
W1.0 is the contract step, so `w10-contracts` legitimately edits these; after the checkpoint they are frozen:
- `src-tauri/src/events.rs`, `src/events.ts`: full 14-event catalog
- `src-tauri/src/sensors/mod.rs`, `src-tauri/src/hub.rs`: trait + all 5 registrations
- `src/behavior/reactions/index.ts`: 6 feature reactions registered
- `src/behavior/types.ts`, `src/render/atlas.ts` (atlas loader), `src/bridge/index.ts`
- `src-tauri/src/lib.rs`, `src/main.ts`, `Cargo.toml`, `package.json` (composition roots/manifests)
- `docs/codemap.md`
- Spec: no edit needed (catalog already complete)

## Budgets
- Task budgets: w10-contracts: 10 (planner 1 + executor 3 batches + debugger reserve 3 + judge 1 + 2 slack)
- Wave budget: 10 + 4 = 14

## Merge order
1. `task/w10-contracts` → `main` after `check full` + `ownership-check.mjs` + judge PASS; checkpoint `feat(core): scaffold tauri app and freeze w1.0 contracts`.

`check full` runs after the merge. On failure the debugger gets 2 attempts in the task worktree; if still failing, hold as `wip/w10-contracts` and escalate (W1.1 cannot start without it).

## Risks
- `tauri::generate_context!` fails in clippy/cargo test when `frontendDist` (`../dist`) is missing → todo 3 makes `check.ps1` build the frontend before Rust steps.
- Biome scanning `evals/` and `scripts/**/*.mjs` and failing on existing harness code → scope `biome.json` `files.includes` to `src/**`, root `*.ts`, `index.html`, and add `--no-errors-on-unmatched` in `check.ps1`.
- Serde adjacently tagged empty payloads (`{}`) → use empty struct variants (`FullscreenEntered {}`), never unit variants; shared JSON fixtures prove both directions.
- `docs-check` treats any dotted string literal in `events.ts` / the Rust enum body as an event → no other dotted literals there (no `"x.y"` in comments or strings).
- `docs-check` warns when a file exists but its codemap entry is still `[planned]` → stub entries are re-tagged `[stub W1.0, fill <task-id>]` (no `planned` word).
- Contract misses a field W2.0 needs → per-feature reaction slices are owned by each reaction file (generic `Reaction<S>`), so W2.0 adds state without touching `types.ts`; only cross-feature `World` facts live in the contract.
- `windows` crate features per sensor will conflict in `Cargo.toml` during W2.0 → out of scope here; W2.0 contract step pre-adds the union (flag for W2.0 planner).
- CI `tauri build` bundles NSIS on every push (slow) → `tauri.conf.json` `bundle.targets: ["nsis"]` only.

# Plan: w10-contracts

- Task id: `w10-contracts`
- Lane: M
- Author: planner, run `w10-contracts-<yyyymmddhhmmss>` (orchestrator fills)
- Worktree/branch: own worktree, `task/w10-contracts`

## Goal
Buildable Tauri v2 + Vite TS app (transparent, frameless, always-on-top, skip-taskbar pet window) with all W1.0 contracts frozen and stubs for every W1.1/W2.0 file the composition roots import; `check.ps1 -Tier fast|full` passes with real projects.

## Files
| Path | Action | Why |
|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`, `index.html`, `rustfmt.toml` | create | tooling; scripts `dev`, `dev:mock` (`vite --mode mock`), `build`, `tauri`, `test` (`vitest run`), `test:golden` (`vitest run --passWithNoTests src/behavior/golden`) |
| `src-tauri/{Cargo.toml,Cargo.lock,build.rs,tauri.conf.json,capabilities/default.json,icons/*}` | create | Tauri v2 crate (lib name `fiore_lib`), window config, minimal permissions |
| `src-tauri/src/{main,lib,events,hub,debug}.rs`, `sensors/mod.rs` | create | contracts |
| `src-tauri/src/{window,logging}.rs`, `sensors/{media,audio_peak,foreground,fullscreen,clock}.rs` | create (stub) | frozen signatures for W1.1/W2.0 |
| `src/{main,events}.ts`, `src/bridge/{index,tauri,mock}.ts`, `src/behavior/types.ts`, `src/render/atlas.ts` | create | contracts (`mock.ts` is a stub) |
| `src/behavior/engine.ts`, `src/behavior/reactions/{index,fullscreen,petting,activity,music,mood,season}.ts`, `src/render/animator.ts`, `src/interaction/{mover,petting}.ts`, `src/debug/panel.ts` | create (stub, except index) | frozen signatures |
| `src/behavior/golden/events/<type>.json` (14) + `src/events.test.ts`, `src/render/atlas.test.ts` | create | shared serde fixtures + tests |
| `scripts/check.ps1`, `docs/codemap.md`, `docs/architecture.md`, `docs/reference/sprite-atlas.md` | edit | wiring + docs |

Interface changes (contract owner only; all frozen at checkpoint):
- `Sensor` trait: `pub trait Sensor: Send + Sync + 'static { fn name(&self) -> &'static str; fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError>; }`. `start` blocks on its own hub-spawned thread; `Err`, a panic (caught with `catch_unwind`) or a closed channel disables that sensor only. Update the Contracts section of `architecture.md` (currently has no return type).
- Atlas schema v1: `SheetDef.variant?: string`, required for `face`/`outfit`/`accessory`, forbidden for `body`. The merge key becomes `(layer, variant, animation)`. Update `sprite-atlas.md`.
- New hub command `frontend_ready` (resends `state.snapshot`, per tauri-v2.md section 4 race) and debug command `emit_debug_event`.

## Todos

### 1. Scaffold (batch A)
- Do: generate `npm create tauri-app@latest` (vanilla-ts) in a temp dir, copy only `src-tauri/icons/` + `build.rs`, then hand-write the rest per tauri-v2.md sections 1-3. Window `main`: transparent, decorations false, alwaysOnTop, skipTaskbar, shadow false, resizable/max/min false, focus false, `visible: false`, noRedirectionBitmap, 160x136 logical (96x96 sprite bottom-centered plus bubble margin), `csp: null`, `bundle.targets ["nsis"]`. Capabilities: `core:default`, `core:window:allow-set-position`, `allow-show`, `allow-hide`. Cargo deps (incl. W1.1 needs): `tauri` (features `tray-icon`), `tauri-plugin-single-instance` (cfg desktop target), `serde`, `serde_json`, `thiserror`, `tracing`, `tracing-subscriber` (`json`, `env-filter`); `[lints.clippy]` per conventions. `index.html` with an inline `<style>` (`html,body{background:transparent;margin:0}`, `image-rendering:pixelated`) and a `<canvas id="pet">` (no `src/style.css`, which would be a new top-level module). Vite config per tauri-v2.md (port 5173 strict, chrome105, watch ignore src-tauri, envPrefix); vitest `test` block in `vite.config.ts`. tsconfig strict + `noUncheckedIndexedAccess`. biome `files.includes` = `src/**`, `*.ts`, `index.html`.
- Criteria: `npm ci` and `npm run build` succeed; `cargo build --manifest-path src-tauri/Cargo.toml` succeeds; `.gitignore` already covers `dist/`, `src-tauri/gen/`, `target/`.
- Verify: `npm ci; npm run build; cargo build --manifest-path src-tauri/Cargo.toml`

### 2. Composition roots + stubs (batch A)
- Do: `main.rs` only calls `fiore_lib::run()`. `lib.rs::run()`: single-instance plugin first (`window::single_instance_plugin()`), `logging::init()`, `setup` → `window::setup(app)`, `hub::start(app, sensors::all())`, invoke handler `[hub::frontend_ready, debug::emit_debug_event]` (debug only under `cfg(debug_assertions)`). Stubs return `Ok(())` or no-ops with frozen signatures: `window::{single_instance_plugin, setup(&mut App) -> Result<(), WindowError>}`, `logging::init() -> Result<(), LoggingError>`. TS stubs: `createEngine(config: EngineConfig): Engine` (always returns the idle resolution), `createAnimator(canvas: HTMLCanvasElement, atlas: MergedAtlas): Animator { render(r: Resolution, now: number): void }`, `createMover(bridge: Bridge): Mover { apply(r: Resolution): void }`, `createPettingDetector(target: HTMLElement, emit: (e: FioreEvent) => void): () => void`, `mountDebugPanel(bridge: Bridge): void`, `createMockBridge(): Bridge` (no-op). `main.ts`: pick the bridge (`import.meta.env.MODE === 'mock'` or no `__TAURI_INTERNALS__` → mock), load the atlas, build the engine/animator/mover, subscribe, `await bridge.ready()`, call `bridge.window.show()` after the first frame; dynamic-import the debug panel only when `import.meta.env.DEV`.
- Criteria: `npm run tauri dev` opens a borderless transparent always-on-top window with no taskbar icon (manual, note in handoff); `npm run dev:mock` serves in a browser without Tauri errors.
- Verify: `pwsh scripts/check.ps1 -Tier fast` (after todo 3)

### 3. Wire check.ps1 (batch A)
- Do: before the Rust steps, when `src-tauri/tauri.conf.json` exists and `dist/index.html` is missing, run a `frontend dist` step (`npm.cmd run build`; FAIL if node_modules is missing). Add `--no-errors-on-unmatched` to the biome call. Keep the CLI unchanged (README section 5).
- Criteria: a fresh clone after `npm ci` passes fast with rustfmt, clippy, tsc, biome, cargo test, npm test and docs-check all PASS (none SKIP); full adds tauri build + golden replay PASS.
- Verify: `pwsh scripts/check.ps1 -Tier fast; $env:FIORE_TAURI_ARGS='--debug --no-bundle'; pwsh scripts/check.ps1 -Tier full`

### 4. FioreEvent + TS mirror + fixtures (batch B)
- Do: `events.rs` with `#[serde(tag="type", content="payload", rename_all_fields="camelCase")]`, 14 variants each with `#[serde(rename="<dot.case>")]`, empty payloads as `Variant {}`; `Category`/`Mood`/`Season` (`rename_all="lowercase"`), `StrokeDirection` left/right, `Snapshot { activity, mood, season, fullscreen, music: MusicState { playing, title?, artist?, source_app? } }` with `skip_serializing_if` on Options. `src/events.ts`: discriminated union, `EVENT_TYPES` const array, `CATEGORIES`/`MOODS`/`SEASONS` consts, `parseFioreEvent(x: unknown): FioreEvent | null` (rejects unknown types and bad payloads, never throws). One fixture per event in `src/behavior/golden/events/`.
- Criteria: the Rust test round-trips every fixture (load with `CARGO_MANIFEST_DIR/../src/behavior/golden/events`), and `serde_json::Value` is equal after re-serialize; `events.test.ts` parses every fixture and rejects an unknown type, a missing field and a wrong enum value; docs-check events PASS for rs and ts.
- Verify: `cargo test --manifest-path src-tauri/Cargo.toml events; npx vitest run src/events.test.ts; node scripts/harness/docs-check.mjs`

### 5. Sensor trait + 5 stubs (batch B)
- Do: `sensors/mod.rs`: trait (above), `SensorError` (thiserror), `pub fn all() -> Vec<Box<dyn Sensor>>` returning media, audio_peak, foreground, fullscreen, clock in that order. Each stub: `name()` returns its file stem, `start` logs `debug` "stub" and returns `Ok(())`.
- Criteria: `all().len() == 5` with unique names (test).
- Verify: `cargo test --manifest-path src-tauri/Cargo.toml sensors`

### 6. Hub (batch B)
- Do: `hub.rs`: `EventSink` trait (`emit(&FioreEvent) -> Result<(), HubError>`; the Tauri impl emits `fiore://event`), `HubState` folding the state fields, `HubHandle { tx }` managed in Tauri state, `start(app, sensors)` spawning one named thread per sensor (catch_unwind, then log `warn`/`error` and disable on Err or panic) plus the hub thread. Rules: (a) the first report of each state field (activity, mood, season, fullscreen, music) is a baseline: fold it in and emit `state.snapshot` instead of the change event (prevents startup one-shots, AC-SN-1 and AC-MS-4); (b) later state events are forwarded only when the value changes; (c) `music.level` is forwarded only while music is playing (AC-MU-3); (d) `pet.*` and injected events pass through; (e) `state.snapshot` is emitted after all sensors are spawned and again on `frontend_ready`; (f) a sink error is logged at `debug` and the event dropped. Expose a pure `Hub::handle(&mut self, ev) -> Vec<FioreEvent>` for tests.
- Criteria: tests named per AC: baseline produces a snapshot with no change event; a duplicate category is dropped; level is dropped while stopped; `frontend_ready` resends the current snapshot; a failing fake sensor and a panicking fake sensor do not stop the others (AC-X-2).
- Verify: `cargo test --manifest-path src-tauri/Cargo.toml hub`

### 7. Debug command (batch B)
- Do: `debug.rs`: `#[tauri::command] pub fn emit_debug_event(event: FioreEvent, hub: State<'_, HubHandle>) -> Result<(), DebugError>` plus `pub fn inject(&HubHandle, FioreEvent)`. Dev-only (`cfg(debug_assertions)`) TCP listener on `127.0.0.1:$FIORE_DEV_PORT` (default 17321), newline-delimited `FioreEvent` JSON; a bad line is logged and skipped. This is the frozen transport `emit-event.mjs` (W1.1) uses.
- Criteria: unit test parses lines (valid, invalid, unknown type); the listener binds to loopback only; nothing is compiled into release builds.
- Verify: `cargo test --manifest-path src-tauri/Cargo.toml debug; pwsh scripts/check.ps1 -Tier fast -Scope src-tauri`

### 8. Engine types (batch C)
- Do: `behavior/types.ts`:
  - Name constants and types: `ANIMATIONS` (19 from spec section 2), `ONE_SHOTS`, `LAYERS`, `FACES` (moods + `happy`), `OUTFITS` (seasons + `summer_glasses`), `ACCESSORIES` (headphones, laptop, notepad, tablet), `OVERLAYS` (`headbob`), `TIERS` in spec priority order, `FEATURES`.
  - Engine shape: `World` (snapshot facts plus music peak), `EngineConfig { rng: Rng; oneShotMs: Partial<Record<OneShot, number>> }`, `EngineInput = {kind:'event';event;now} | {kind:'tick';now}`, `Resolution { body: Animation|null; face; outfit; accessory; overlay; speed; bubble: string|null; visible: boolean; move: 'stay'|'wander' }`, `Engine { handle(i: EngineInput): Resolution }`.
  - Reaction shape: `Contribution { tier; body?; face?; outfit?; accessory?; overlay?; speed?; bubble?; hidden? }`, `Effect = {kind:'oneShot'; animation: OneShot}`, `ReactionContext { now; rng; world; config }`, `Reaction<S> { id; init(world): S; reduce(s, ev, ctx): {slice: S; effects}; tick(s, ctx): {slice: S; effects}; contribute(s, ctx): Contribution | null }`, `defineReaction<S>()` (erases S for the registry).
- Criteria: tsc strict passes; no `any`; `satisfies` checks tie the consts to the types; the `FIORE_EVENT` switch helper has an exhaustive `never` check.
- Verify: `npx tsc --noEmit`

### 9. Reaction registry + 6 stubs (batch C)
- Do: each `reactions/<feature>.ts` exports `<feature>Reaction = defineReaction<{}>({...})` as a no-op (`contribute` returns null). `index.ts` exports `REACTIONS` in order fullscreen, petting, activity, music, mood, season.
- Criteria: a test asserts the 6 ids are unique and match `FEATURES`; the stubs are pure (no imports outside `../types` and `../../events`).
- Verify: `npx vitest run src/behavior`

### 10. Atlas schema + loader (batch C)
- Do: `render/atlas.ts`: types per sprite-atlas.md section 2 (+ `variant`), `SPRITE_GROUPS` (7 groups); `parseAtlas(json, group)`, `validateImage(sheet, {width,height})`, `mergeAtlases(files)`, `loadAtlases({fetchJson, loadImage, log, groups?})`; `MergedAtlas.lookup(layer, variant, anim)` falls back to the `"*"` entry, and `MergedAtlas.body(anim)` falls back to base `idle` with a single log. A missing group file is logged and skipped (only `base` exists until W2.0). Errors are thrown as `AtlasError`: duplicate key, unknown animation or variant, count mismatch against the body animation, bad `headOffset` length, image too small, `version !== 1`, group/file mismatch. Provide `browserImageLoader` here (DOM stays in render).
- Criteria: `atlas.test.ts` covers each error case and both fallbacks using inline objects (no PNGs).
- Verify: `npx vitest run src/render/atlas.test.ts`

### 11. Bridge contract (batch C)
- Do: `bridge/index.ts`: `Bridge { kind; subscribe(h): Promise<() => void>; ready(); emitDebug(e); window: {show; hide; setPosition(x, y)} }` plus `selectBridge()`. `bridge/tauri.ts`: `listen('fiore://event')` with a synchronous handler and `parseFioreEvent` (log and drop invalid events); `invoke('frontend_ready')`; `invoke('emit_debug_event', { event })`.
- Criteria: Tauri imports appear only in `bridge/` (and later `mover.ts`), checked by grep in the handoff.
- Verify: `pwsh scripts/check.ps1 -Tier fast -Scope src`

### 12. Docs (batch C)
- Do: codemap: remove `[planned W1.0]` from landed files; add `src-tauri/src/lib.rs` and `src/behavior/golden/events/*.json`; re-tag stubs `[stub W1.0, fill <task-id>]`. Update `architecture.md` (Sensor signature, hub baseline/forward rules, `frontend_ready`, debug transport) and `sprite-atlas.md` (variant, status changes from proposed to frozen, points at `src/render/atlas.ts`). Bump `last-verified` on all three.
- Criteria: docs-check has 0 errors; no copied text across docs.
- Verify: `node scripts/harness/docs-check.mjs`

### 13. Final gate
- Do: run the full tier and record the manual `tauri dev` window observation in the handoff.
- Criteria: fast and full pass; the handoff lists the frozen signatures for W1.1.
- Verify: `pwsh scripts/check.ps1 -Tier full`

## Risks
- Ambiguity in the engine composition rules (e.g. how hide plays above the `hidden` tier) → the contract only provides `tier`, `hidden` and `oneShotMs` in context; the sequencing semantics belong to `w11-engine` / `w20-fullscreen`. Do not design them here.
- `headbob` treated as a body animation would conflict with `code` → frozen as `Resolution.overlay`; the animator decides how to draw it (W1.1).
- Executor scope creep into real sensor, animator or window logic → stubs must stay no-ops; the judge checks the scope.

## Out of scope
- W1.1: animator drawing and base sprites, engine priority logic and golden replays, tray and WindowMover wandering, `logging.rs` JSON output, mock bridge scripting, `emit-event.mjs`, simulators.
- W2.0: any real sensor or reaction logic, feature sprite groups, `app-categories.json`, `windows` crate features.
- Autostart, installer polish and perf (W3.0). Harness file edits.

Lesson candidates:
- [#tauri #rust] when clippy/cargo test runs before a frontend build, ensure `frontendDist` exists first, because `generate_context!` fails at compile time without it.
- [#harness #docs] when a contract step pre-creates fill-in stubs, tag them `[stub W<wave>, fill <task>]` in the codemap rather than `[planned]`, because docs-check warns on existing files that are still tagged planned.
