# Backend rules (`src-tauri/**`)

Purpose: rules that apply only to the Rust backend. Global rules live in `/AGENTS.md`.
last-verified: 2026-11-07

- Style and error policy: `docs/conventions.md` (Rust section). Threading/COM: `docs/architecture.md`.
- Verified API notes: `docs/reference/windows-crate.md`, `docs/reference/win-apis.md`, `docs/reference/tauri-v2.md`.

## Hard rules
1. **No `unwrap`/`expect`/`panic!`/indexing panics outside tests.** Return typed errors (`thiserror`). `clippy -D warnings` must pass.
2. **A sensor never crashes the app.** Errors are logged with `tracing`, the sensor is disabled, the hub keeps running. No panics inside sensor threads.
3. **One OS thread (or task) per sensor.** Initialize COM/WinRT on the thread that uses it (`CoInitializeEx` MTA, or the WinRT equivalent) and uninitialize on exit. Never share COM interface pointers across threads.
4. **Every `unsafe` block carries a `// SAFETY:` comment** naming the invariant. Keep blocks minimal and wrap them in a safe function.
5. **OS access goes behind a trait** so logic is unit-testable with a mock (`Sensor` plus a per-sensor `*Source` trait). Pure logic (debounce, classifier, mood/season, fullscreen rect compare) lives in functions with no OS calls.
6. Poll rates are fixed by the spec (foreground 500 ms, audio peak ~15 Hz while playing, clock 60 s, fullscreen event-driven or <= 500 ms). Do not poll faster. Idle CPU budget is < 1%.
7. **Privacy:** never read keystroke content. Log window titles and track names only at `debug` level, never `info` and above.
8. `events.rs`, `hub.rs`, `sensors/mod.rs` and the `FioreEvent` enum are contract files: executors fill their own `sensors/<name>.rs` only; report needed changes as a deviation.
9. Add `windows` crate feature flags only for APIs you use, in `Cargo.toml`; note the API-to-feature mapping in the PR/handoff.
10. Tauri v2 only (not v1 APIs). Capabilities live in `src-tauri/capabilities/`; grant the minimum permission set.
11. Logging: `tracing` JSON lines to `logs/fiore-dev.log` in dev; no `println!`.
