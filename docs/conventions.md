# Conventions

Purpose: code style, naming, commit format and comment policy for Rust and TypeScript.
last-verified: 2026-11-07

## Rust (`src-tauri/`)
- Edition 2021+, `rustfmt.toml` enforced; `clippy -D warnings` (lints configured in `Cargo.toml`).
- Errors: `thiserror` enums per module; return `Result`, propagate with `?`. No `unwrap`/`expect`/`panic!` outside `#[cfg(test)]`. `anyhow` is not used in library modules.
- Logging: `tracing` macros with structured fields (`tracing::warn!(sensor = "media", error = %e, "poll failed")`). No `println!`. Titles/track names at `debug` only.
- `unsafe`: smallest possible block, wrapped in a safe fn, preceded by `// SAFETY: <invariant>`.
- OS access behind traits (`Sensor`, `<Name>Source`); pure logic in free functions; unit tests inline in `#[cfg(test)] mod tests`.
- `windows` crate: enable only needed feature flags; see `docs/reference/windows-crate.md`.
- Naming: modules and files `snake_case`; types `PascalCase`; one sensor per file under `sensors/`, registered in `sensors/mod.rs`.
- Serde: events use `dot.case` type names and camelCase payload fields (`docs/architecture.md`).

## TypeScript (`src/`)
- `strict` true; no `any`; no non-null assertion without a justifying comment. Biome handles lint and format.
- Files `kebab-case.ts` or single-word lowercase (`engine.ts`); exports `camelCase`/`PascalCase` for types.
- Layout: `behavior/` (pure engine + reactions), `render/` (DOM/canvas), `interaction/` (pointer logic, mover), `bridge/` (Tauri/mock), `events.ts` (mirror of Rust enum), `debug/` (dev panel). Module map: `docs/codemap.md`.
- Engine and reactions are pure (no I/O, DOM, timers, `Date.now`, `Math.random`). Inject `now` and `rng`.
- Tauri APIs are imported only in `bridge/` and `interaction/mover.ts`.
- Use discriminated unions and exhaustive `switch` (with a `never` check) over `FioreEvent`.
- Animation, layer and atlas names are constants/types from `behavior/types.ts`, not inline strings.
- Tests: Vitest, colocated `*.test.ts`; golden replays in `src/behavior/golden/` (see `docs/testing.md`).

## Naming
- Events: `dot.case` (`music.started`, `pet.hover_start`); snake_case segments allowed after the dot as in the catalog.
- Task ids `<wave>-<slug>`; branches `task/<task-id>` (the id already includes the wave, so `w20-music` is `task/w20-music`); run ids `<task-id>-<yyyymmddhhmmss>` (see `docs/harness/README.md`).
- Sprite groups: lowercase single word (`base`, `activity`, `music`, `petting`, `fullscreen`, `outfits`, `faces`).

## Commits
Conventional commits: `type(scope): summary`. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `build`, `ci`. Scopes: feature or area (`music`, `fullscreen`, `engine`, `harness`). Imperative, <= 72 chars. Checkpoint commits follow a judge PASS. Never force-push.

## Comments
Comment only constraints the code cannot show (why, invariants, OS quirks, safety). No narration of what code does, no change-history comments. TODOs require a `docs/backlog.md` entry and are written `TODO(backlog): <summary>`.

## Docs
Each doc starts with a one-line purpose and `last-verified`. Link to the owning doc instead of copying text. Update `last-verified` when you edit.
