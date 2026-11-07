---
name: eval
description: Run the Fiore harness eval suite (evals/run.mjs) for all tasks or one task id, compare with evals/baseline.json, and summarize regressions. Use for `/eval [task-id]`, when harness files changed, or after applying a proposal.
disable-model-invocation: true
---

# /eval [task-id]

Evals measure the harness itself: each task runs `/ship` in a fresh worktree at a pinned commit, then is graded. Contract: `docs/harness/README.md` section 5. Evals never run in CI and cost usage; run only when harness files changed (`.cursor/agents|rules|skills|hooks`, `docs/harness/*` except `lessons.md`) or the user asks.

## 1. Preconditions
- `CURSOR_API_KEY` set in the **environment** (never read or write it from a file; never echo it). If missing, stop and ask the user to set it.
- Clean working tree for harness files you intend to evaluate (commit or stash unrelated changes), so results are attributable.

```powershell
if (-not $env:CURSOR_API_KEY) { "CURSOR_API_KEY not set" }
```

## 2. Run
```powershell
node evals/run.mjs                    # whole suite
node evals/run.mjs <task-id>          # one task
node evals/run.mjs --concurrency 3    # default is the runner's; keep <= 5
```
Exit code `0` ok, `1` task failures, `2` usage, `3` budget exceeded. Output: `evals/results/<date>.json` (gitignored).

## 3. Grade and compare
Read the new result against `evals/baseline.json`. Graders per task: `check full` passes; hidden tests pass; judge rubric score; lane classified as expected; subagent calls and retries within budget; wall time.

**Regression** (any one) = a pass became a fail, calls rose by more than 30%, or rubric score dropped. Wall time alone is informational.

If there is no baseline yet (Phase 0 first run), report results as the proposed baseline; do not write it.

## 4. Report (<= 25 lines)
```text
Eval <date>: <n> tasks, <p> pass, <f> fail
task            lane(exp/act)  calls(base->now)  rubric(base->now)  result
...
Regressions: <none | list with the metric that moved>
Verdict: NO REGRESSION | REGRESSION
```
For each regression: first failing grader, the run id (`.harness/runs/<run-id>.json`), and the likely cause among the changed harness files.

## 5. Baseline policy
- **Never** update `evals/baseline.json` yourself. Propose it and wait for the user's explicit approval; then copy the results file over it.
- Called from `/approve-proposal`: return the verdict and let that skill keep or revert.
- Seed tasks: docs-only change (XS, no judge); config rule (S); seeded script bug (debugger, root cause). Foundation tasks are added in Phase 1.
