# Eval tasks

Purpose: format of `evals/tasks/<id>.yaml` as consumed by `evals/run.mjs`; extends `docs/harness/templates/eval-task.yaml`.
last-verified: 2026-11-07

Run: `node evals/run.mjs [<task-id>] [--concurrency n]` (needs `CURSOR_API_KEY` in the environment; install the SDK once with `npm ci --prefix evals`). `--dry-run` validates tasks without the key.

## Flow per task
1. Cut a worktree on branch `task/eval-<id>-<stamp>` at `base_commit` (a missing tag falls back to HEAD with a warning).
2. Copy `seed_files` in and commit them, so the agent's diff is measured against the seeded state.
3. Local `@cursor/sdk` agent in that worktree, project settings loaded, prompt `/ship <prompt>`.
4. Snapshot changed files, then copy `hidden_tests` in, then run `scripts/check.ps1 -Tier full` and `hidden_commands`.
5. Grade, compare with `evals/baseline.json`, write `evals/results/<date>-<time>.json`, remove the worktree (`--keep` to inspect it).

## Keys
| Key | Meaning |
|---|---|
| `id`, `description`, `base_commit`, `prompt`, `expected_lane` | As in the template. `id` matches the file name. |
| `expected_judge` | `none`, `quick` or `full`. Default: `none` for XS, otherwise `full`. `none` fails the task if a judge subagent ran. |
| `expected_roles` | Roles that must be called at least once (for example `debugger`). |
| `allowed_paths` | Globs the agent may change; anything else is out of scope. `.harness/**` is always ignored. |
| `protected_paths` | Globs that must not be deleted. |
| `seed_files` | `{src, dest}` copied into the worktree before the run (sources live under `evals/seed/<id>/`). |
| `hidden_tests` | `{src, dest}` copied in after the run (sources live under `evals/hidden/<id>/`, destination `eval-hidden/`). |
| `hidden_commands` | Shell commands run in the worktree after hidden files land; all must exit 0. |
| `budget` | `max_calls`, `max_retries`, `max_wall_seconds` (wall time is informational). |
| `graders` | `check_full`, `hidden_tests`, `lane_correct`, `within_budget` (set `false` to disable); `rubric_min` (judge score out of 14). |

The YAML reader is a small subset parser: nested maps, lists of scalars or maps, `|` block scalars, inline lists, comments. No anchors or multi-document files.

## Seed tasks
| Id | Lane | What it checks |
|---|---|---|
| `docs-glossary-wave-budget` | XS, no judge | Docs-only edit stays in the cheap lane. |
| `config-lint-rules` | S | Small config change across 3 files gets a judge verdict. |
| `debug-mood-night` | S, debugger | Crash far from a range-check bug; root cause fixed, not the symptom. |

## Regression rule
Any of: a pass became a fail, calls rose by more than 30%, rubric score dropped. Update `evals/baseline.json` only after the user approves (`--write-baseline --yes`).
