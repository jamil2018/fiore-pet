# ADR-0005: Parallel waves (contract-first, file ownership, worktrees for code)

Purpose: record how parallel agents work without conflicts: contract steps, ownership claims and isolation.
last-verified: 2026-11-07

- **Status:** accepted
- **Date:** 2026-11-07

## Context
Phase 2 has five independent features. Serial work is slow; naive parallel work causes merge conflicts, false check failures from others' half-finished code, and shared-log collisions.

## Decision
Every wave is: serial **contract step** (freezes shared interfaces and pre-creates shared files: full `FioreEvent` enum + TS mirror, sensor stubs registered, reaction stubs, codemap entries, split atlas schema), parallel **fan-out** (each task owns disjoint paths), serial **integration** (merge in dependency order, `check full` after each merge, ownership check, one judge, checkpoint, retro).
- Tasks declare `owns:`/`reads:` globs; `run-state.mjs claim` refuses overlapping claims (enforced by the `subagentStart` hook); `ownership-check.mjs` flags out-of-claim edits at integration.
- Docs/config waves share the checkout (disjoint paths, nothing compiled). Code waves use one git worktree and `task/<task-id>` branch per task (the id already includes the wave), max 5 concurrent, with sccache and per-worktree `CARGO_TARGET_DIR`.
- Anything appended is one file per task (handoff, metrics, run state); only the orchestrator writes `lessons.md`.
- A failing branch gets a 2-attempt debugger budget, then is held back (`wip/<task-id>`) and rescheduled alone; the rest of the wave still merges.

## Alternatives
- **All parallel agents in one checkout for code:** `check` sees partial work and reports false failures (churn).
- **Fully serial:** safest, but the 5-wide feature wave becomes 5x slower.
- **Shared atlas/registry edited by every task:** guaranteed conflicts; replaced by contract stubs and per-feature files.

## Consequences
- W1.0 is the deliberate serial bottleneck; it makes the 4-wide and 5-wide fan-outs conflict-free.
- Executors never edit shared files; needed interface changes become deviations applied at integration.
- Cost and CPU are bounded by the 5-agent cap.
- Contract changes after W1.0 require a new serial contract step.
