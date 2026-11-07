# Wave plan: <wave>

Purpose: planner output for a whole wave (one planner call per wave). Saved as `.harness/waves/<wave>.md`; drives claims, executor launch and merge order. Cap: ~120 lines.
last-verified: 2026-11-07

- Wave id: `<wave>` (for example `w20`)
- Phase: <P1 | P2 | P3>
- Contract frozen at: `<commit or tag>`
- Isolation: worktrees (`task/<task-id>`) | shared checkout (docs/config only)
- Concurrency cap: <n> (max 5 code agents)

## Goal
<One or two sentences.>

## Tasks
One block per task. `owns:` globs must be disjoint across tasks; `run-state.mjs claim` refuses overlaps.

### `<wave>-<slug>`
- Lane: <XS | S | M>
- Budget: <n> calls
- Goal: <one line>
- owns:
  - `<repo-relative glob>`
- reads:
  - `<repo-relative glob>`
- Depends on: <task ids or `none`>
- Task packet: `.harness/plans/<wave>-<slug>.md`

## Shared files (contract owner / integration only)
Executors never edit these; needed changes come back as deviations.
- `<path>`: <what integration will apply>

## Budgets
- Task budgets: <task>: <n>, ...
- Wave budget: <sum of task budgets> + 4 = <total>

## Merge order
1. `task/<wave>-<slug>` (<reason, e.g. sensors before reactions>)
2. `task/<wave>-<slug>`

`check full` runs after each merge. A failing branch gets the debugger (2 attempts); if it still fails it is held back as `wip/<task-id>` and rescheduled alone in the next wave.

## Risks
- <Risk> -> <mitigation>
