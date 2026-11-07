# Task packet: <task-id>

Purpose: the only context a subagent receives. The orchestrator fills it once; roles never re-explore what is here. Keep it under ~120 lines; link to docs by path, do not paste them.
last-verified: 2026-11-07

- Task id: `<wave>-<slug>`
- Run id: `<task-id>-<yyyymmddhhmmss>`
- Role this packet is for: planner | executor | debugger | judge | explorer
- Branch / worktree: `task/<task-id>` at `<path>` (or `main` for non-wave work)

## Goal
<One or two sentences. What must be true when this is done.>

## Lane
<XS | S | M | L>  (why: <one line>)

## Spec excerpts
<Only the relevant lines from `docs/fiore-mvp-spec.md`, each with its section name. No full copies of other docs.>

- <excerpt 1>
- <excerpt 2>

## Lessons
<Entries from `docs/harness/lessons.md` whose tags match this task. Write `none` if no tag matches.>

- `[#tag] when X, do Y, because Z`

## Paths
Owns (may edit):
- `<glob>`

Reads (read-only):
- `<glob>`

Explorer findings (path:line-range, short note):
- `<path>:<start>-<end>`: <note>

## Acceptance criteria
1. <Observable, testable criterion>
2. <Observable, testable criterion>

## Check command
`pwsh scripts/check.ps1 -Tier fast -Scope <owned paths>`

## Budget remaining
- Lane budget: <n> subagent calls (used <u>, remaining <r>)
- Role cap: <e.g. executor: 2 check attempts>
- On exhaustion: stop and report; do not retry.

## Out of scope
- <Things the role must not do or touch>
