# Debug report: <task-id>

Purpose: debugger output shape. The debugger owns the problem until `check` passes or the 3-attempt budget runs out. Cap: ~60 lines.
last-verified: 2026-11-07

- Run ID: `<run-id>`
- Branch: `task/<task-id>`
- Attempt: <n> of 3

## Reproduction
- Command: `<exact command>`
- Observed: <failing output, <= 10 lines>
- Reproduced: yes | no | intermittent

## Hypothesis log
Up to 3. Mark each as proven or rejected with the evidence used (log line, test, or experiment).

| # | Hypothesis | Evidence | Outcome |
|---|---|---|---|
| 1 | <hypothesis> | <log/test> | proven / rejected |

## Root cause
<One paragraph. The actual cause, not the symptom.>

## Fix
- `<path>:<line>`: <minimal change>
- Scope kept to the failing behavior: yes | no (<why>)

## Regression test
- Added: `<test path / name>`
- Fails without the fix: yes | no

## Check result
- Command: `pwsh scripts/check.ps1 -Tier fast`
- Result: PASS | FAIL | SKIP

## Lesson candidates
- `[#tag] when X, do Y, because Z`  (or `none`)
