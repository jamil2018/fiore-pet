# Backlog

Purpose: minor judge findings and deferred items, each with its source run.
last-verified: 2026-11-08

Format: `- [ ] <summary> (source: <run-id or "plan">, <date>)`. Every `TODO(backlog)` in code must have an entry here.

## Open
- [ ] Typing-rate and caret tracking (keystroke counts only, never content) (source: plan, 2026-11-07)
- [ ] Idle detection leading to sleep (source: plan, 2026-11-07)
- [ ] CPU load makes the pet sweat (source: plan, 2026-11-07)
- [ ] Gaming detection (source: plan, 2026-11-07)
- [ ] Settings window (source: plan, 2026-11-07)
- [ ] Per-sensor toggles (source: plan, 2026-11-07)
- [ ] Art-generation role (source: plan, 2026-11-07)
- [ ] Test-first tester role (source: plan, 2026-11-07)
- [ ] Replace placeholder sprites with final art (drop-in, no code changes) (source: plan, 2026-11-07)
- [ ] In `Hub::inject`, replace the named `_folded` binding with `let _` or `drop`, or comment that the fold return is discarded on purpose (source: w10-contracts, 2026-11-08)
- [ ] Rename `debug::inject` (for example to `forward_line`) so it is distinct from `Hub::inject` (source: w10-contracts, 2026-11-08)
- [ ] Hover shows body `idle` over the activity animation; the spec has no separate looks-up pose (`engine.ts`) (source: w11-judge, 2026-11-08)
- [ ] Wander moves the window while the body stays `idle`; `walk` is never selected (`engine.ts`) (source: w11-judge, 2026-11-08)
- [ ] "One stretch per day" is a rolling 24 hours, not a calendar day (`engine.ts`) (source: w11-judge, 2026-11-08)
- [ ] Animator resets canvas CSS size and `image-rendering` on every render (`animator.ts`) (source: w11-judge, 2026-11-08)
- [ ] With `overlayLevel` at 0, headbob plays at 0.75× its previous rate until the music reaction feeds a level. Confirm it looks right at W2.1 (`animator.ts`) (source: w20-contract, 2026-11-08)
- [ ] `main.ts` discards the cleanup function from `createPettingDetector`. Harmless while the frontend never remounts; keep it if the frontend is remounted (`main.ts`) (source: w20-contract, 2026-11-08)
- [ ] `ownership-check.mjs` for `w20-contract` exits 2 because there is no claim file. `check full` was re-run on `main` after the merge and passed (source: w20-contract, 2026-11-08)

## Done
- [x] W2.0 contract step: engine-owned defaults are documented in `docs/architecture.md` (rules A–C). A reaction adds to those defaults and suppresses only its own feature's one-shots. (source: w11-judge, 2026-11-08)
- [x] Codemap no longer describes a set-position command in `window.rs`; wander uses `bridge.window.setPosition` (source: w11-judge, 2026-11-08)
- [x] Frontend calls `bridge.window.hide`/`show` when `resolution.visible` flips (source: w11-judge, 2026-11-08)
