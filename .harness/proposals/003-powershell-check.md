---
id: 003
title: Check via Windows PowerShell when pwsh is missing
date: 2026-11-08
status: proposed
---

files:
- .cursor/skills/ship/SKILL.md
- AGENTS.md

# Proposal 003: powershell-check

Purpose: stop the first check attempt failing because `pwsh` is not installed.
last-verified: 2026-11-08

## Problem and evidence
Every W1.1 executor reported `pwsh` missing, then passed `scripts/check.ps1` under Windows PowerShell 5.1. The script itself was fine. The wasted attempt is the documented command.

- w11-render, w11-engine, w11-window, w11-devtools: first check note was `pwsh` not on PATH; the same `-File scripts/check.ps1` run under `powershell.exe` passed.
- w11-followup: first `check fast` failed only because `pwsh` was absent; the rerun passed 8/8.

## Exact diff
```diff
--- a/AGENTS.md
+++ b/AGENTS.md
@@
-- `pwsh scripts/check.ps1 -Tier fast [-Scope <paths>]`: fmt, clippy, tsc, biome, unit tests, docs-check
-- `pwsh scripts/check.ps1 -Tier full`: fast + Tauri build + golden replay
+- `powershell -File scripts/check.ps1 -Tier fast [-Scope <paths>]`: fmt, clippy, tsc, biome, unit tests, docs-check
+- `powershell -File scripts/check.ps1 -Tier full`: fast + Tauri build + golden replay

--- a/.cursor/skills/ship/SKILL.md
+++ b/.cursor/skills/ship/SKILL.md
@@
-pwsh scripts/check.ps1 -Tier fast -Scope <owned paths>
+powershell -File scripts/check.ps1 -Tier fast -Scope <owned paths>
```

`pwsh` still works if it is on PATH; this only changes the command the harness tells the agent to run. Do not apply until this proposal is approved.

## Expected metric change
| Metric | Current | Expected |
|---|---|---|
| First check attempt lost to `pwsh` not recognized | 1 per task on this machine | 0 |

## Eval tasks to watch
- `fix-broken-debounce`: debugger lane still runs check
- `add-event-end-to-end`: M-lane check still passes
- `debug-mood-night`: no change in hidden-test result

## Regression rule
If any eval task regresses against `evals/baseline.json` (pass becomes fail, calls up more than 30%, or rubric score drops), revert automatically and mark this proposal `rejected`.
