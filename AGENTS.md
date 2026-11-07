# Fiore agent guide

Mission: Fiore is a Windows desktop pet (Tauri v2, Rust + TypeScript, 32x32 pixel art). Behavior comes only from the event catalog in the spec.

## Commands
- `pwsh scripts/check.ps1 -Tier fast [-Scope <paths>]`: fmt, clippy, tsc, biome, unit tests, docs-check
- `pwsh scripts/check.ps1 -Tier full`: fast + Tauri build + golden replay
- `npm run dev` / `npm run dev:mock` / `npm run tauri dev`: app, browser mock mode, real app (from W1.0)
- `node scripts/harness/run-state.mjs ...`: run state, budgets, claims
- `node scripts/dev/emit-event.mjs <event> [json]`: inject an event (from W1.1)

## Doc map (read the one you need, not all)
- Scope + event catalog (source of truth): `docs/fiore-mvp-spec.md`
- Design, threading, errors: `docs/architecture.md`; find code: `docs/codemap.md`
- Style and naming: `docs/conventions.md`; tests: `docs/testing.md`
- Review checklist: `docs/definition-of-done.md`; deferred items: `docs/backlog.md`
- Why decisions were made: `docs/decisions/`; terms: `docs/glossary.md`
- Harness contract (paths, roles, lanes, CLIs): `docs/harness/README.md`
- Verified API notes: `docs/reference/`; lessons: `docs/harness/lessons.md`
- Nested rules: `src/AGENTS.md`, `src-tauri/AGENTS.md`

## Hard rules
1. Nothing outside the spec's event catalog triggers behavior. Add events in the spec first.
2. Privacy: never read keystroke content. Window titles and track names only at debug log level.
3. Sensor failure is logged and that sensor disabled; it never crashes the app.
4. Stay in your task's `owns:` paths. Shared/contract files (codemap, spec, `FioreEvent`, registries) change only via a reported deviation.
5. Smallest lane that fits (XS/S/M/L); respect budgets; at a cap, escalate to the user, never retry.
6. Run `check fast -Scope <your paths>` before handoff; never skip tests or silence lints to pass.
7. Only the orchestrator writes `docs/harness/lessons.md`; return lesson candidates instead.
8. No copied text across docs: link to the owning doc. Update `last-verified` when editing a doc.
9. Secrets come from the environment only; never commit them. Evals run in the IDE and do not use an API key.
10. Never push `--force`, nor push `task/*` branches to `main`.
