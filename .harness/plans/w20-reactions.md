# W2.0 plan: MVP reactions

Purpose: contract step plus wave plan for W2.0 (fullscreen, petting, app activity, music, mood/season).
last-verified: 2026-11-08

- Wave id: `w20` · Phase: P2 · Base: `p1-foundation` (`cd99921`)
- Isolation: one worktree per task under `.worktrees/<task-id>` (gitignored), branch `task/<task-id>`, set up by `.cursor/worktrees.json`, which uses sccache and a separate cargo target directory per worktree.
- Concurrency cap: 5 code agents. Tasks start from the contract commit, not from `p1-foundation`.

## Goal
Fill the 5 sensor stubs, the reaction files, the per-group sprite atlases and the acceptance-criteria tests for spec sections 3.1–3.5. No task edits a shared file.

---

## Part 1: `w20-contract` (serial, lane M, budget 10, own judge, checkpoint on `main` as in W1.0)

**Decision (closes backlog major "W2.0 contract step"): engine-owned defaults, not a move into reactions.**
- Why: the engine already implements nearly every spec rule, and goldens cover them. Moving the rules now means a large serial refactor, and all five tasks would need `engine.ts`.
- What the tasks still need from TypeScript is small and additive: occasional `think`, lean direction, bob level, and goldens.
- Engine-owned (tasks must not re-implement these):
  - world fold;
  - one-shot queue;
  - priority resolver;
  - hide/appear and the hidden tier;
  - petting phases (hover, stroke, happy, afterglow) and `wag`;
  - activity body and prop;
  - dance/headbob/headphones, `notice`, `jump` and the 3 s bubble;
  - mood face/speed, stretch, yawn;
  - outfit, `summer_glasses` and twirl.

Contract todos (contract owner only; all of these are shared files):

**C1. Document the policy in `docs/architecture.md` (Engine section).** Add:
- a table of each engine-owned rule, its `FeatureId`, and whether it can be suppressed;
- rule A: a reaction's effects suppress only the default effects of the same feature, for that event or tick;
- rule B: reaction contributions come after the engine's, so a reaction wins a tie at the same tier;
- rule C: a reaction uses its own random stream (`ctx.rng`), so features can't change each other's random sequences.

Move the backlog item to Done and update `last-verified`.
- AC: the doc has the table and rules A–C.

**C2. `engine.ts` changes.**
- Tag each default effect with its `FeatureId`:
  - `wag` belongs to petting;
  - `notice` and `jump` belong to music;
  - `stretch` and `yawn` belong to mood;
  - `twirl` belongs to season.
- `effectsForEvent` and `effectsForTick` skip only the defaults of features whose reaction emitted effects.
- At `createEngine`, draw one seed per reaction, in registry order, from `config.rng`. Give each reaction a pure mulberry32 random stream inside `engine.ts`.
- Re-baseline any existing golden whose seeded `jump` or `yawn` timing moves.
- AC: new cases in `src/behavior/engine.test.ts`:
  - (a) an activity reaction emitting on a tick does not suppress a due `yawn`;
  - (b) a music reaction effect on `music.started` replaces the default `notice`;
  - (c) a same-tier body contribution from a reaction beats the engine's;
  - (d) a reaction drawing from its random stream does not change the default `jump` outcome.

**C3. Shared type freeze in `types.ts`, `golden.test.ts` and `animator.ts`.**
- Types:
  - add `Facing = 'left' | 'right'`;
  - add `Contribution.facing?` and `Contribution.overlayLevel?` (0..1);
  - add `Resolution.facing` (default `'right'`) and `Resolution.overlayLevel` (default 0).
- Resolver: same priority-rank rule as the other fields.
- `golden.test.ts`: add both keys to `EXPECT_KEYS`.
- Animator:
  - `facing: 'left'` mirrors every layer horizontally, including the x of `headOffset`;
  - the overlay frame rate is multiplied by `0.75 + 0.5 × overlayLevel`;
  - the headbob `headOffset` y is doubled when `overlayLevel >= 0.6`, so offsets stay whole pixels.
- AC: `tsc` passes, existing goldens pass, and the animator unit test covers mirror and level.

**C4. Wire petting into `main.ts`.**
- Call `createPettingDetector(canvas, emit)`. `emit` feeds `engine.handle({kind:'event', event, now: performance.now()})`, then calls `present`.
- Keep the stub signature frozen: `(target: HTMLElement, emit: (e: FioreEvent) => void) => () => void`.
- AC: mock mode still boots (`npm run dev:mock`).

**C5. Split sprite keys so each group has one owner.**
- Create the group `.json` files with entries that still point at `base.png` rows (the image path is relative to `public/sprites/`, so there is no visual change). Remove the moved keys from `base.json`.

| Group | Keys |
|---|---|
| `base` (stays) | body: idle, walk, sit, notice, jump |
| `fullscreen.json` | body: hide, appear |
| `petting.json` | body: lean, happy, wag; face: happy |
| `music.json` | body: dance, headbob; accessory: headphones |
| `activity.json` | accessory: laptop, notepad, tablet. Body code/think/write/browse are added by its task. |
| `faces.json` | face: energetic, content, calm, sleepy; body: stretch, yawn |
| `outfits.json` | outfit: winter, spring, summer, autumn, summer_glasses; body: twirl |

- After this step `base.*` is frozen. Update `src/render/base-atlas.test.ts` so it checks the merged atlas.
- AC: `loadAtlases` reports no collision and the merged key set matches the set before the split.

**C6. `src-tauri/Cargo.toml`.**
- Add `[target.'cfg(windows)'.dependencies.windows]` with `version = "0.62"` and the full feature list from `docs/reference/windows-crate.md` section 2: `Win32_Foundation`, `Win32_Graphics_Gdi`, `Win32_Media_Audio`, `Win32_Media_Audio_Endpoints`, `Win32_System_Com`, `Win32_System_Com_StructuredStorage`, `Win32_System_Variant`, `Win32_System_Threading`, `Win32_System_WinRT`, `Win32_UI_Shell`, `Win32_UI_WindowsAndMessaging`, `Media_Control`, `Foundation`, `Foundation_Collections`.
- Add `chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }`.
- Commit `Cargo.lock`. Tasks add no dependencies; a needed one is reported as a deviation.
- AC: `cargo tree -i windows` shows a single 0.62.x.

**C7. Create `src-tauri/src/sensors/win.rs` and add `mod win;` to `sensors/mod.rs`.** Gate it with `#[cfg(windows)]` and implement it from the `[run]`-verified snippets in `win-apis.md`.

It contains:
- `WinRtGuard::mta()` and `ComGuard::mta()`. These guards are created inside the thread that uses them and can't be sent to another thread; `Drop` balances `S_FALSE`.
- `foreground() -> Option<ForegroundWindow { hwnd, pid, exe_name: Option<String>, title, class }>`, where `exe_name` is the file name only.
- `is_own_pid(pid)`.
- `#[allow(dead_code)] // used by W2.0 sensors; removed at W2.1`.

After this step the file is contract-owned and read-only for tasks.
- AC: clippy is clean, and a unit test checks `is_own_pid(std::process::id())`.

**C8. Conventions for the sensor tasks (architecture.md, Threading section).** Add one line to spec section 3.5 for the hemisphere and fake-clock rules (a contract-owned edit).
1. **Baseline:** each sensor reports its current state immediately at start, without waiting for its debounce or hold. The hub turns that first report into `state.snapshot`.
2. **Music playing flag:** shared through `pub(super) static MUSIC_PLAYING: AtomicBool` in `media.rs`. `audio_peak.rs` reads it. `mod.rs` constructors stay unit structs.
3. **Category rules:** `app-categories.json` is embedded with `include_str!` and parsed at start. `tauri.conf.json` is not changed.
4. **Hemisphere:** `FIORE_HEMISPHERE=south` flips the seasons; anything else, or unset, means north.
5. **Fake clock:** `FIORE_FAKE_CLOCK` (`%Y-%m-%dT%H:%M:%S`) sets the starting time, and the clock advances in real time from there. An invalid value logs a `warn` and the system clock is used.
6. **Music detection:** "is music playing" means any GSMTC session in `GetSessions()` is `Playing`.

**C9. Codemap.**
- Tag the sprite groups `[stub W2.0, fill <task>]` and add a line for `win.rs`.
- Leave `app-categories.json` tagged `[planned W2.0 w20-app-category]`.
- Update `last-verified`.

**Contract verify:** `pwsh scripts/check.ps1 -Tier full` (Cargo and goldens changed), then the judge, then a checkpoint commit on `main` (`chore(contract): freeze W2.0 interfaces`). Create the worktrees after that.

---

## Part 2: Tasks

All Rust tasks share these rules:
- OS calls go behind a `*Source` trait with a `#[cfg(windows)]` implementation. Pure logic has no OS calls, and tests never call real APIs.
- Use `park_timeout` or `recv_timeout` sleeps.
- Transient errors retry with a capped backoff; a fatal error returns `Err`, which disables the sensor.
- Titles and track names are logged at `debug` only.

All TypeScript reactions import only `../types` and `../../events` (the registry test enforces this). Sprites follow the `sprite-atlas` skill: a task may keep the `base.png` references from C5, or add rows to its own `<group>.png`. Never edit `base.*`.

### `w20-fullscreen`
- Lane M · Budget 10 · Depends on: contract
- owns:
  - `src-tauri/src/sensors/fullscreen.rs`
  - `src/behavior/reactions/fullscreen.ts`
  - `public/sprites/fullscreen.png`, `public/sprites/fullscreen.json`
  - `src/behavior/golden/fullscreen-*.json`
- reads:
  - `src-tauri/src/sensors/{mod,win}.rs`, `src-tauri/src/{events,hub}.rs`
  - `src/behavior/{engine,types}.ts`
  - `docs/reference/win-apis.md` sections 3 and 5, `docs/reference/windows-crate.md`, `docs/reference/sprite-atlas.md`
  - `scripts/dev/sim/fullscreen-window.ps1`

Todos:
1. Pure functions:
   - `shell_blocks(state) -> bool`: true only for `QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN` and `QUNS_PRESENTATION_MODE`;
   - `covers(window, monitor) -> bool`: uses `<=`/`>=` containment against `rcMonitor`;
   - `excluded(class, pid, own)`: `Progman`, `WorkerW`, `Shell_TrayWnd`, and our own PID;
   - `decide(...)`;
   - an `Edge` tracker that emits only on change. A shell-state `Err` keeps the previous value.
2. `FullscreenSource` with a Windows implementation: `SHQueryUserNotificationState`, `win::foreground()`, `MonitorFromWindow` + `GetMonitorInfoW` + `GetWindowRect`. Re-query handles on every poll.
3. Sensor loop:
   - take a `ComGuard`;
   - emit the baseline (`fullscreen.entered` or `exited`);
   - poll every 500 ms.
4. Golden `fullscreen-hidden-updates.json`:
   - AC-FS-2: `app.category_changed` and `music.started` while hidden give `visible: false` and no one-shot;
   - AC-FS-3: after `exited`, `appear` plays, then the body is `code` or `dance` according to state.
5. Sprites: `hide` (wave, dive, dust puff, fade, about 1000 ms) and `appear` (bounce, shake). `reactions/fullscreen.ts` stays a stub because this behavior is engine-owned.
- AC: AC-FS-1..4. Unit tests cover all 7 shell values, own PID, desktop classes, a window larger than the monitor, a maximized work-area window, and no repeated emits.
- Verify:
  - `pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors/fullscreen.rs,src/behavior,public/sprites`
  - `cargo test --manifest-path src-tauri/Cargo.toml sensors::fullscreen`
  - `npx vitest run src/behavior/golden.test.ts`

### `w20-petting`
- Lane M · Budget 10 · Depends on: contract (C3 `facing`, C4 wiring)
- owns:
  - `src/interaction/petting.ts`, `src/interaction/petting.test.ts`
  - `src/behavior/reactions/petting.ts`, `src/behavior/reactions/petting.test.ts`
  - `public/sprites/petting.png`, `public/sprites/petting.json`
  - `src/behavior/golden/petting-*.json` (includes the existing `petting-priority.json`)
- reads: `src/main.ts`, `src/behavior/{engine,types}.ts`, `src/events.ts`, `docs/reference/sprite-atlas.md`

Todos:
1. Pure `createStrokeTracker()` with `enter(t)`, `move(x, t)` and `leave(t)`, returning `FioreEvent[]`:
   - a stroke is a direction reversal after at least 12 px of travel since the last extreme;
   - `direction` is the new direction of movement;
   - `pet.petted` fires once when 3 strokes fall within 2000 ms (inclusive), then the window resets;
   - `hover_end.wasPetted` is true if `pet.petted` fired during this hover.
2. `createPettingDetector`: uses `pointerenter`, `pointermove` and `pointerleave` (with `clientX` and `timeStamp`), and returns a cleanup function that removes the listeners. No keyboard listeners and no timers.
3. `reactions/petting.ts`: track the last stroke direction from `hover_start` to `hover_end`, and contribute `{tier: 'petting', facing}`. Never contribute `body`; the petting phases are engine-owned.
4. Tests:
   - AC-PT-1: an 11 px reversal emits nothing, 12 px emits a stroke;
   - AC-PT-2: 3 strokes in 2.0 s emit `pet.petted`, 3 strokes in 2.5 s do not;
   - AC-PT-5: a source-text scan finds no `key*` listeners;
   - cleanup works on a fake EventTarget.
   - Golden `petting-lean-wag.json`: AC-PT-3, AC-PT-4, and `facing: 'left'` after a left stroke.
5. Sprites: `lean` (drawn facing right; mirrored by `facing`), `happy` with hearts in the frames, `wag`, face `happy`.
- AC: AC-PT-1..5.
- Verify:
  - `pwsh scripts/check.ps1 -Tier fast -Scope src/interaction,src/behavior,public/sprites`
  - `npx vitest run src/interaction/petting.test.ts src/behavior`

### `w20-app-category`
- Lane M · Budget 10 · Depends on: contract
- owns:
  - `src-tauri/src/sensors/foreground.rs`
  - `src-tauri/resources/app-categories.json`
  - `src/behavior/reactions/activity.ts`, `src/behavior/reactions/activity.test.ts`
  - `public/sprites/activity.png`, `public/sprites/activity.json`
  - `src/behavior/golden/activity-*.json`
- reads:
  - `src-tauri/src/sensors/{mod,win}.rs`, `src-tauri/src/{events,hub}.rs`
  - `docs/reference/win-apis.md` section 4
  - `src/behavior/{engine,types}.ts`
  - `scripts/dev/sim/start-notepad.ps1`

Todos:
1. `app-categories.json` holds every rule from spec section 3.3: per-category process lists, plus writing title keywords that apply only to browser processes. Embed it with `include_str!`. A parse error becomes a `SensorError`. A unit test checks that the embedded file parses.
2. Pure classifier `classify(exe_name, title, &rules) -> Category`:
   - case-insensitive file-name match;
   - for a browser, a writing-title keyword means `writing`, otherwise `browsing`;
   - an unknown process is `other`.
3. Pure `HoldDebounce`:
   - a candidate must hold for 1500 ms before it is emitted;
   - a revert inside that window emits nothing;
   - the first sample is the baseline and is emitted immediately.
4. `ForegroundSource` using `win::foreground()`. A null foreground window or our own PID skips the tick and keeps the previous candidate. Poll every 500 ms and emit `{category, process: exe_name or "", title}`.
5. `reactions/activity.ts`:
   - while coding, contribute `{tier: 'activity', body: 'think'}` for 2 s, every 20–40 s;
   - draw from `ctx.rng` only when scheduling the next `think`;
   - reset when the category changes;
   - the laptop prop stays from the engine.
6. Goldens:
   - `activity-categories.json` (AC-AC-5): coding gives `code` + laptop, writing gives `write` + notepad, browsing gives `browse` + tablet, `other` gives idle + wander, and `other` with music gives `dance`;
   - a seeded `think` case.
7. Sprites: body `code`, `think`, `write`, `browse` added to `activity.json`/`activity.png`. The accessories from C5 stay.
- AC: AC-AC-1..5.
- Verify:
  - `pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors/foreground.rs,src-tauri/resources,src/behavior,public/sprites`
  - `cargo test --manifest-path src-tauri/Cargo.toml sensors::foreground`

### `w20-music`
- Lane M · Budget 10 · Depends on: contract
- owns:
  - `src-tauri/src/sensors/media.rs`, `src-tauri/src/sensors/audio_peak.rs`
  - `src/behavior/reactions/music.ts`, `src/behavior/reactions/music.test.ts`
  - `public/sprites/music.png`, `public/sprites/music.json`
  - `src/behavior/golden/music-*.json` (includes the 2 existing files)
- reads:
  - `src-tauri/src/sensors/{mod,win}.rs`, `src-tauri/src/{events,hub}.rs`
  - `docs/reference/win-apis.md` sections 1–2, `docs/reference/windows-crate.md` section 4
  - `src/behavior/{engine,types}.ts`
  - `scripts/dev/sim/play-test-tone.ps1`

Todos:
1. Pure `MusicTracker::sample(Option<Track>, now) -> Vec<FioreEvent>`:
   - baseline: the first sample emits `started` or `stopped`;
   - `started` fires when playing begins after a stop;
   - `track_changed` fires when title or artist changes while playing; empty titles are ignored;
   - `stopped` fires after 2000 ms with nothing playing, and a shorter pause emits nothing;
   - set and clear `MUSIC_PLAYING` together with `started` and `stopped`.
2. GSMTC source:
   - take a `WinRtGuard`;
   - call `RequestAsync().join()` once;
   - on each poll, use the first `Playing` session in `GetSessions()`, preferring the current session;
   - `Err(empty)` means no session;
   - register a manager `SessionsChanged` handler that only signals; the loop uses `recv_timeout(500 ms)`;
   - remove the handler tokens on exit.
3. `audio_peak.rs`:
   - while not playing, check the flag every 250 ms, with no meter calls;
   - while playing, open the meter lazily under a `ComGuard`;
   - every 66 ms (about 15 Hz), emit `music.level` with the peak clamped to 0..1;
   - on an error, drop the meter and retry with backoff (1 s doubling to 30 s); a transient error never disables the sensor.
4. Tests:
   - AC-MU-5 (a pause shorter than 2 s versus a stop of 2 s or more);
   - `started` and `track_changed`, and empty titles;
   - AC-MU-6: the loop step with a mock source emits no level while the flag is false;
   - clamp and backoff.
5. `reactions/music.ts`:
   - smooth the level with an exponential moving average (α about 0.3) of the `music.level` peak;
   - while playing, contribute `{tier: 'music', overlayLevel}`;
   - reset on `stopped`.
   - `notice`, `jump`, the bubble and the headphones stay engine-owned.
6. Golden `music-level.json`:
   - AC-MU-3: levels are ignored while stopped, and a peak of 0.8 or less never jumps;
   - AC-MU-4: the bubble clears after 3 s;
   - AC-MU-5: headphones and dance are removed;
   - `overlayLevel` rises with the peak.
7. Sprites: `dance`, `headbob`, accessory `headphones`.
- AC: AC-MU-1..6.
- Verify:
  - `pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors/media.rs,src-tauri/src/sensors/audio_peak.rs,src/behavior,public/sprites`
  - `cargo test --manifest-path src-tauri/Cargo.toml sensors::media sensors::audio_peak`

### `w20-mood-season`
- Lane M · Budget 10 · Depends on: contract
- owns:
  - `src-tauri/src/sensors/clock.rs`
  - `src/behavior/reactions/mood.ts`, `src/behavior/reactions/season.ts`
  - `src/behavior/reactions/mood.test.ts`, `src/behavior/reactions/season.test.ts`
  - `public/sprites/faces.png`, `public/sprites/faces.json`
  - `public/sprites/outfits.png`, `public/sprites/outfits.json`
  - `src/behavior/golden/mood-*.json` (includes `mood-season.json`), `src/behavior/golden/season-*.json`
- reads: `src-tauri/src/sensors/mod.rs`, `src-tauri/src/{events,hub}.rs`, `src/behavior/{engine,types}.ts`, `scripts/dev/sim/set-fake-clock.ps1`

Todos:
1. Pure functions and clock source:
   - `mood_for(h, m)` and `season_for(month, Hemisphere)`;
   - `Hemisphere::from_env`;
   - a `Clock` trait with `SystemClock` (`chrono::Local`) and `FakeClock`, which parses the stamp and advances with an `Instant`;
   - `next_wake(now)`: the earlier of the next minute and the next midnight, capped at 60 s.
2. Sensor loop:
   - baseline: emit `time.mood_changed` and `season.changed` at start;
   - after that, emit each one only when it changes;
   - check the season at midnight.
3. Tests:
   - AC-MS-1: every boundary in the table;
   - AC-MS-2: including Feb 29 2028, and the south hemisphere flip;
   - fake-clock parsing, advance and invalid fallback;
   - emit only on change;
   - midnight wake-up math.
4. Goldens:
   - `mood-speed.json` (AC-MS-3): the body is unchanged across all 4 moods, and speed is 1.2, 1, 0.85 and 0.7;
   - AC-MS-5: `stretch` at most once in 24 h, `yawn` only while sleepy, and the 2–4 min interval;
   - `season-twirl.json` (AC-MS-4): no twirl on the snapshot, twirl on the first change only;
   - `summer_glasses` only while coding.
   - `mood.ts` and `season.ts` stay stubs because this behavior is engine-owned.
5. Sprites: faces (energetic, content, calm, sleepy), `stretch`, `yawn`, the 5 outfit variants, `twirl`.
- AC: AC-MS-1..5.
- Verify:
  - `pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors/clock.rs,src/behavior,public/sprites`
  - `cargo test --manifest-path src-tauri/Cargo.toml sensors::clock`

---

## Shared files (contract or integration only)
These are never in any task's `owns:`: `docs/codemap.md`, `docs/fiore-mvp-spec.md`, `docs/architecture.md`, `events.rs`/`events.ts`, `hub.rs`, `sensors/mod.rs`, `sensors/win.rs`, `types.ts`, `engine.ts`, `reactions/index.ts`, `golden.test.ts`, `main.ts`, `render/*`, `public/sprites/base.*`, `Cargo.toml`/`Cargo.lock`, `package*.json`, `tauri.conf.json`, `golden/events/*`.

Expected integration deviations (W2.1):
- remove the `[planned]`/`[stub]` codemap tags;
- remove the `#[allow(dead_code)]` in `win.rs`;
- backlog entries: no visible output for "happiness rises"; the hover look-up pose is still missing; "eyes follow cursor" is deferred because there is no pointer data in the engine.

## Budgets
- Contract: 10 (separate run).
- Tasks: fullscreen 10, petting 10, app-category 10, music 10, mood-season 10.
- Wave budget: 50 + 4 = 54.

## Merge order
The `owns:` sets are disjoint and there are no dependencies between tasks, so the order goes from lowest to highest risk. That keeps `main` green longest.
1. `task/w20-mood-season`: pure logic, with no COM or WinRT.
2. `task/w20-app-category`: plain Win32 calls through `win.rs`.
3. `task/w20-fullscreen`: Win32, plus a golden that depends on activity and music state.
4. `task/w20-petting`: TypeScript only, and it relies on the C4 wiring.
5. `task/w20-music`: two sensors and a WinRT `.join()` that can hang.

Run `check full` after each merge, then `ownership-check.mjs`, then one judge for the wave. A branch that fails twice under the debugger is held back as `wip/<task-id>`.

## Risks
- **Goldens change when seeds or random streams change.** Contract step C2 isolates each reaction's random stream and re-baselines the existing goldens first. Tasks then run all goldens before handoff.
- **A WinRT `.join()` call can block forever.** It stays only on the media thread, and the hub never waits on it. The manual check uses `play-test-tone.ps1`, which goes through Windows Media Player per the lessons.
- **Fullscreen detection may flap or give false positives on maximized windows.** If the simulator shows that, require 2 equal samples before emitting. Treat a missing `WS_CAPTION` check as a follow-up, not a spec change.
- **Five cold Rust builds with many `windows` features at once.** C6 builds the lock first; sccache plus a separate target per worktree handle the rest. Start the code agents a few minutes apart.
- **Pointer events on a transparent window.** Petting is verified in mock mode first; the real window is checked manually at W2.1.
- **Sprite key collisions.** C5 gives each key exactly one group, and `base.*` is frozen.
- **Calendar-day stretch and the hover pose.** Both stay in the backlog. The engine has no wall clock and there is no pose asset, so these are out of scope.

## Out of scope
Settings, a UI for per-sensor toggles, a wall clock in the engine, eyes following the cursor, hub changes, new `FioreEvent` variants.

Lesson candidates:
- [#engine #reactions] when several reactions share one `rng`, give each reaction its own seeded stream in the contract, because one feature's draws otherwise shift another feature's seeded goldens.
- [#sprites #harness] when a later wave splits sprite groups out of `base`, move the keys in the contract step and point the new group files at `base.png`, because otherwise every task needs `base.json` and the same key in two groups is a load error.
