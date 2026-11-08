# Testing

Purpose: what is tested where, the golden replay format, how sensors are mocked, and what stays manual.
last-verified: 2026-11-08

Run with `pwsh scripts/check.ps1 -Tier fast|full [-Scope <paths>]`. `fast` = unit tests; `full` adds golden replay and the Tauri build.

## What is tested where
| Area | Tool | Location | Covers |
|---|---|---|---|
| Rust pure logic | `cargo test` | inline `#[cfg(test)]` in each module | app classifier + debounce (`foreground.rs`), mood/season mapping (`clock.rs`), fullscreen rect compare (`fullscreen.rs`), music stop debounce (`media.rs`), event serde round-trip (`events.rs`) |
| Frontend units | Vitest | colocated `*.test.ts` | engine priority (`behavior/`), petting detector (`interaction/petting.ts`), animator frame timing and layer alignment (`render/`), atlas loader merge, reactions |
| Golden replay | Vitest | `src/behavior/golden/*.json` + `golden.test.ts` | event sequence -> resulting layers; main behavior regression net |
| Serde contract | `cargo test` + Vitest | `events.rs`, `src/events.ts` | Rust and TS agree on every catalog event (shared JSON fixtures in `src/behavior/golden/events/`) |
| Docs | `docs-check.mjs` | run by `check` | catalog <-> enum, codemap paths, size limits |

Every acceptance criterion (`AC-*` in the spec) maps to an automated test or a manual checklist item below. Name tests after the criterion (`ac_pt_2_three_strokes_in_two_seconds`).

## Golden replay format
File `src/behavior/golden/<name>.json`:
```json
{
  "name": "music-while-coding",
  "start": { "now": 0, "seed": 1, "snapshot": { "activity": "other", "mood": "content", "season": "autumn", "fullscreen": false, "music": { "playing": false } } },
  "steps": [
    { "at": 0, "event": { "type": "app.category_changed", "payload": { "category": "coding", "process": "Code.exe", "title": "x" } },
      "expect": { "body": "code", "face": "content", "outfit": "autumn", "accessory": "laptop" } },
    { "at": 500, "event": { "type": "music.started", "payload": { "title": "t", "artist": "a", "sourceApp": "Spotify.exe" } },
      "expect": { "body": "notice" } },
    { "at": 1500, "tick": true, "expect": { "body": "code", "overlay": "headbob", "accessory": "headphones" } }
  ]
}
```
- Illustrative: exact `expect` field names are finalized by the engine types in `src/behavior/types.ts` (W1.0), which win over this example.
- `at` is engine time in ms (the engine receives it as `now`); `seed` seeds `rng`. `tick: true` advances time without an event.
- `expect` lists only the layer fields asserted (`body`, `overlay`, `face`, `outfit`, `accessory`, `speed`, `bubble`); omitted fields are not checked.
- Cross-feature priority cases (W2.1) are golden files too.

## Mocking sensors
- Every OS API sits behind a trait (e.g. `MediaSource`, `ForegroundSource`, `ClockSource`, `FullscreenSource`, `AudioMeterSource`). Tests inject a scripted fake that yields a sequence of readings; the sensor's logic (debounce, classification, edge detection) is driven synchronously via a pure `step(reading, now)` function.
- Time is injected (`now`), never read from the system inside testable logic. `FIORE_FAKE_CLOCK` overrides the clock sensor for manual runs.
- Hub tests use a fake sensor emitting scripted events and assert emitted order and `state.snapshot`.
- Frontend uses `src/bridge/mock.ts`; tests feed events directly to the engine.

## Manual / simulator checks
Not automatable: real media playback, real fullscreen, real foreground apps, tray, autostart/installer, perf. Covered by simulators (`scripts/dev/sim/`: `start-notepad.ps1`, `play-test-tone.ps1`, `fullscreen-window.ps1`, `FIORE_FAKE_CLOCK`) and `emit-event.mjs`.
v0.1.0 results, idle CPU/RAM numbers, and the sampler CLI (`scripts/dev/perf-sample.ps1`) are in `docs/release/v0.1.0-checklist.md`. Catalog to run:
- [ ] Each catalog event triggered by hand plays its documented reaction.
- [ ] `FIORE_FAKE_CLOCK` covers every mood and season.
- [ ] Notepad -> `writing`; browser -> `browsing`; editor -> `coding`.
- [ ] Test tone -> `music.started`, `music.level`, `music.stopped` after 2 s silence.
- [ ] Fullscreen window -> hide; exit -> appear.
- [ ] Petting gestures; tray Show/Hide/Quit; single instance.
- [ ] Idle CPU < 1%, RAM < ~60 MB.
The judge accepts a documented manual check for these only.

## Rules
- No deleting or skipping tests to pass. A bug fix adds a regression test.
- Tests are deterministic: no real time, no network, no OS calls outside integration marked `#[ignore]`.
- Visual checks in mock mode use a `cursor-ide-browser` screenshot of `npm run dev:mock`.
