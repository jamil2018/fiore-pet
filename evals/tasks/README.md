# Eval tasks

Purpose: format of `evals/tasks/<id>.yaml` as consumed by `evals/run.mjs`. Execution is `/eval` in the IDE. CLI: `docs/harness/README.md` section 5.
last-verified: 2026-11-08

Grade: `node evals/run.mjs --grade --manifest <prepare.json>` or `--grade --worktree <path>`. `--dry-run` validates YAML. Nothing in this runner reads an API key.

## Flow per task
1. `--prepare` cuts a worktree on `task/eval-<id>-<stamp>` at `base_commit` (a missing tag falls back to HEAD) and commits `seed_files` so the diff is measured against the seeded state.
2. The IDE runs `/ship` with `prompt` in that worktree (subscription). The script does not start an agent.
3. `--grade` snapshots changed files, copies `hidden_tests` from this checkout, then runs `scripts/check.ps1 -Tier full` and `hidden_commands`.
4. Lane, calls, and the judge score come from `.harness/runs`, `.harness/verdict.json`, and `.harness/eval-result.txt`.
5. Compare with `evals/baseline.json`, write `evals/results/<date>-<time>.json`, then `--cleanup` removes the worktree.

## Keys
| Key | Meaning |
|---|---|
| `id`, `description`, `base_commit`, `prompt`, `expected_lane` | As in `docs/harness/templates/eval-task.yaml`. `id` matches the file name. |
| `expected_judge` | `none`, `quick` or `full`. Default: `none` for XS, otherwise `full`. `none` fails the task if a judge subagent ran. |
| `expected_roles` | Roles that must appear in the run-state call log (for example `debugger`). |
| `allowed_paths` | Globs the agent may change; anything else is out of scope. `.harness/**` and `eval-hidden/**` are ignored. |
| `protected_paths` | Globs that must not be deleted. |
| `seed_files` | `{src, dest}` copied into the worktree before the run (sources live under `evals/seed/<id>/`). |
| `hidden_tests` | `{src, dest}` copied in by the grader after the run (sources under `evals/hidden/<id>/`, destination `eval-hidden/`). |
| `hidden_commands` | Shell commands run in the worktree after hidden files land; all must exit 0. |
| `budget` | `max_calls`, `max_retries`, `max_wall_seconds` (wall time is informational and not measured here). |
| `graders` | `check_full`, `hidden_tests`, `lane_correct`, `within_budget` (set `false` to disable); `rubric_min` (judge score out of 14). |

The YAML reader is a small subset parser: nested maps, lists of scalars or maps, `|` block scalars, inline lists, comments. No anchors or multi-document files.

## Seed tasks
| Id | Lane | What it checks |
|---|---|---|
| `docs-glossary-wave-budget` | XS, no judge | Docs-only edit stays in the cheap lane. |
| `config-lint-rules` | S | Small config change across 3 files gets a judge verdict. |
| `debug-mood-night` | S, debugger | Crash far from a range-check bug; root cause fixed, not the symptom. |

## Foundation tasks
Pinned to `p1-foundation`. Each one is a sandbox under `evals/seed/<id>/` plus a hidden grader. They measure the Phase 1 skills without editing the product catalog or the sprite sheets. Execution is still `/eval` in the IDE. No `@cursor/sdk` and no API key.

| Id | Lane | What it checks |
|---|---|---|
| `add-event-end-to-end` | M | One new event lands in the catalog row, both mirrors, and the sensor sample. |
| `add-animation` | S | One one-shot atlas entry, an engine mapping, and a golden stub. |
| `fix-broken-debounce` | S, debugger | Hold-window crash; the root cause is the debounce anchor, not the throw site. |

`--offline-grade` runs steps 3-5 against those seed fixtures with no agent. Live pass, calls, and rubric stay null. That recording is baseline v0 (`method: offline-grade`). The three foundation tasks are not in v0 until an approved refresh.

## Regression rule
A live pass became a fail, calls rose by more than 30%, or the rubric score dropped. Null live metrics are not a regression. Update `evals/baseline.json` only after the user approves (`--write-baseline --yes` on a `--grade` or `--offline-grade` run).
