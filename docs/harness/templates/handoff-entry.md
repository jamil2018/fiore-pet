# Handoff: <task-id>

Purpose: executor/debugger handoff written to `.harness/handoff/<task-id>.md` (one file per task, never shared). Cap: ~40 lines.
last-verified: 2026-11-07

- Role: executor | debugger
- Run ID: `<task-id>-<yyyymmddhhmmss>`
- Branch: `task/<task-id>`

## Changed files
- `<path>` (created | edited | deleted): <one line>

## Check result
- Command: `pwsh scripts/check.ps1 -Tier fast -Scope <paths>`
- Result: PASS | FAIL | SKIP (<steps skipped>)
- Attempt: <n> of <cap>
- Failure summary (if FAIL): <first failing step and message, <= 5 lines>

## Deviations
Anything outside the plan or the claimed `owns:` paths, and any needed change to a shared/contract file. Write `none` if none.

- <deviation>: <why; what integration must apply>

## Lesson candidates
Returned to the orchestrator, which is the only writer of `docs/harness/lessons.md`. Write `none` if none.

- `[#tag] when X, do Y, because Z`
