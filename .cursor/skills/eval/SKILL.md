---
name: eval
description: Run Fiore harness evals on the Cursor IDE subscription. Prepare worktrees, execute each task with /ship, then grade with evals/run.mjs. Use for `/eval [task-id]`, when harness files changed, or after applying a proposal.
disable-model-invocation: true
---

# /eval [task-id]

Evals measure the harness. The IDE subscription executes each task. `evals/run.mjs` only grades. No `CURSOR_API_KEY` and no `@cursor/sdk`. CLI: `docs/harness/README.md` section 5. Evals never run in CI. Run when harness files changed (`.cursor/agents|rules|skills|hooks`, `docs/harness/*` except `lessons.md`) or the user asks.

## 1. Prepare
```powershell
node evals/run.mjs --prepare
node evals/run.mjs --prepare <task-id>
```
This cuts a worktree on `task/eval-<id>-<stamp>` at `base_commit` (a missing tag falls back to HEAD), copies seed files, and writes `evals/results/prepare-<stamp>.json` (gitignored). The manifest lists `worktree`, `branch`, and `prompt`.

## 2. Execute (subscription)
For each manifest entry, run `/ship` with that prompt inside the worktree (this chat, or an executor Task). Same subscription path as normal harness work. Do not push. Do not copy hidden tests; the grader does that after the run.

The finished worktree must contain:
- the task edits (committed or not)
- `.harness/runs/<run-id>.json` from `run-state.mjs` (lane, calls, state `done`)
- `.harness/verdict.json` when the task expects a judge (`record-verdict.mjs`)
- `.harness/eval-result.txt` with one line: `EVAL-RESULT lane=<XS|S|M|L> run=<run-id>`

Write `eval-result.txt` from the agent's final reply if the agent did not.

## 3. Grade
```powershell
node evals/run.mjs --grade --manifest evals/results/prepare-<stamp>.json
node evals/run.mjs --grade --worktree <path> --task <task-id>
node evals/run.mjs --cleanup --manifest evals/results/prepare-<stamp>.json
```
The grader copies hidden tests from this checkout, runs `scripts/check.ps1 -Tier full` and `hidden_commands`, reads `.harness/`, compares with `evals/baseline.json`, and writes `evals/results/<date>-<time>.json`. Exit `0` ok, `1` task failure or regression, `2` usage, `3` budget exceeded only.

## 4. Report (<= 25 lines)
```text
Eval <date>: <n> tasks, <p> pass, <f> fail, <o> offline
task            lane(exp/act)  calls(base->now)  rubric(base->now)  result
...
Regressions: <none | list with the metric that moved>
Verdict: NO REGRESSION | REGRESSION
```
A task with `pass: null` is offline (not a live measurement). For each regression: first failing grader, run id, and the likely cause among the changed harness files.

**Regression** = a live pass became a fail, calls rose by more than 30%, or rubric score dropped. Null live metrics are not a regression. Wall time is informational.

## 5. Baseline
Never update `evals/baseline.json` yourself. After the user approves:
```powershell
node evals/run.mjs --grade --manifest <file> --write-baseline --yes
```
v0 (`method: offline-grade`, `runner: ide`) is a seed-fixture dry-run with null live metrics. Replace it with a live grade when one exists. Called from `/approve-proposal`: return the verdict and let that skill keep or revert.

## 6. Offline dry-run
`node evals/run.mjs --offline-grade` grades the committed seed fixtures with no agent. It checks that hidden tests and `check.ps1` run. It does not measure lane, calls, or rubric. `--list` and `--dry-run` only validate YAML.
