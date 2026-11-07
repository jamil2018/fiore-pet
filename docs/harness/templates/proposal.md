# Proposal NNN: <slug>

Purpose: `/retro` output shape for self-evolution changes to agents, rules, skills, hooks or scripts. Saved as `.harness/proposals/NNN-<slug>.md`; applied only after user approval via `/approve-proposal`.
last-verified: 2026-11-07

- Id: `NNN`
- Status: proposed | approved | applied | rejected
- Created: <yyyy-mm-dd> by `/retro` (phase/wave: <id>)

## Problem and evidence
<What goes wrong, with data: run ids, metrics numbers, judge FAIL reasons, lesson ids.>

- <evidence 1: source and number>
- <evidence 2>

## Exact diff
Target files and the precise change. Must be directly applicable.

```diff
--- a/<path>
+++ b/<path>
@@
-<old line>
+<new line>
```

## Expected metric change
| Metric | Current | Expected |
|---|---|---|
| <e.g. calls per S-lane task> | <n> | <n> |

## Eval tasks to watch
- `<eval-task-id>`: <what should improve or stay the same>

## Regression rule
If any eval task regresses against `evals/baseline.json` (pass becomes fail, calls up more than 30%, or rubric score drops), revert automatically and mark this proposal `rejected`.
