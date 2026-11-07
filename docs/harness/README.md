# Harness contract

Purpose: the single index of every harness file path, template name, script CLI and ownership convention. W0.1 tasks implement against this file; they do not invent paths.
last-verified: 2026-11-07

Status: **contract only**. Paths below are reserved by the W0.0 skeleton; files are created by the wave named in the "Wave" column.

## 1. Roles (`.cursor/agents/<role>.md`)

| Role | File | Model | Mode | Call cap |
|---|---|---|---|---|
| planner | `.cursor/agents/planner.md` | `claude-opus-5-5-medium` | read-only | 2 explorer calls |
| executor | `.cursor/agents/executor.md` | `grok-4.7-high-fast` | write | 2 check attempts |
| debugger | `.cursor/agents/debugger.md` | `claude-sonnet-5-5-high` | write | 3 attempts |
| judge | `.cursor/agents/judge.md` | `claude-opus-5-5-medium` | read-only | 1 run per task/wave |
| explorer | `.cursor/agents/explorer.md` | `composer-2.5-fast` | read-only | output <= 60 lines |

Every role prompt: <= 80 lines, 8 sections (Identity, Inputs, Must-read, Procedure, Output, Budget and stop conditions, Never, Lesson capture).

## 2. Lanes, budgets, run states

| Lane | Use | Flow | Subagent-call budget |
|---|---|---|---|
| XS | docs/config/one-liner | executor, check (judge quick; skipped for docs-only) | 3 |
| S | 1-3 files, no interface change | executor, check, judge | 5 |
| M | new feature / interface change | explorer(s), planner, executor, check, judge | 10 |
| L | one phase (several M runs) | one judge at phase end | 25 |

Wave budget = sum of task budgets + 4 (planner, judge, integration).

States: `intake`, `plan`, `execute`, `check`, `debug`, `judge`, `done`, `escalate`.
Allowed transitions are defined in `scripts/harness/run-state.mjs`; illegal transitions exit non-zero. Hitting a budget moves the run to `escalate` and the orchestrator must stop and report.

## 3. Directory and file map

### Tracked
| Path | Contents | Wave |
|---|---|---|
| `.cursor/agents/*.md` | 5 role prompts | W0.1 |
| `.cursor/rules/{harness,rust,ts,docs}.mdc` | rules | W0.1 |
| `.cursor/skills/<name>/SKILL.md` | `ship`, `wave`, `integrate`, `eval`, `retro`, `approve-proposal`, `tauri-v2`, `win32-sensor`, `sprite-atlas`, `debug-windows-app`; Phase 1: `new-sensor`, `new-animation` | W0.1 / W1.2 |
| `.cursor/hooks.json`, `.cursor/hooks/*` | hook config + scripts | W0.1 |
| `.cursor/worktrees.json`, `scripts/setup-worktree-windows.ps1` | worktree bootstrap | W0.1 |
| `.harness/plans/<task-id>.md` | task plans | runtime |
| `.harness/waves/<wave>.md` | wave plan + ownership map | runtime |
| `.harness/proposals/NNN-<slug>.md` | self-evolution proposals | runtime |
| `docs/*.md`, `docs/decisions/`, `docs/reference/` | project docs | W0.1 |
| `docs/harness/*` | this contract, rubric, lessons, templates | W0.0 / W0.1 |
| `evals/run.mjs`, `evals/tasks/*.yaml`, `evals/baseline.json` | eval suite | W0.1 / W0.2 |
| `scripts/check.ps1`, `scripts/harness/*.mjs`, `scripts/dev/**` | tooling | W0.1 / W1.1 |
| `.github/workflows/check.yml` | CI | W0.1 |
| `AGENTS.md`, `src/AGENTS.md`, `src-tauri/AGENTS.md` | agent instructions | W0.1 |

### Local only (gitignored; dirs kept via `.gitkeep`)
| Path | Contents |
|---|---|
| `.harness/runs/<run-id>.json` | run state + audit trail |
| `.harness/metrics/<run-id>.jsonl` | one metrics file per run (no shared appends) |
| `.harness/claims/<task-id>.json` | path claims for running tasks |
| `.harness/handoff/<task-id>.md` | executor/debugger handoff, one file per task |
| `.harness/verdict.json` | last judge verdict + diff fingerprint |
| `evals/results/<date>.json` | eval output |
| `logs/`, `target/`, `node_modules/` | runtime/build output |

### Product layout (reserved by skeleton, filled from W1.0)
`src-tauri/src/{main,events,hub,window,logging}.rs`, `src-tauri/src/sensors/`, `src-tauri/resources/app-categories.json`; `src/{events.ts}`, `src/behavior/`, `src/behavior/reactions/{index.ts,<feature>.ts}`, `src/render/`, `src/interaction/`, `src/bridge/`; `public/sprites/<group>.{png,json}`.

## 4. Templates (`docs/harness/templates/`)

| File | Shape |
|---|---|
| `task-packet.md` | goal, lane, spec excerpts, lessons, paths, acceptance criteria, check command, budget remaining |
| `plan.md` | goal, files, todos (criteria + verify command), risks, out-of-scope |
| `handoff-entry.md` | role, run ID, changed files, check result, deviations, lesson candidates |
| `judge-report.md` | verdict, rubric scores, findings (severity, file:line, expected fix) |
| `debug-report.md` | reproduction, hypothesis log, root cause, fix, regression test |
| `lesson.md` | `[tags] when X, do Y, because Z (run-id, date)` |
| `proposal.md` | problem + evidence, exact diff, expected metric change, eval tasks to watch |
| `eval-task.yaml` | base commit, prompt, expected lane, hidden tests, budget |
| `wave-plan.md` | wave id, tasks, per-task `owns:`/`reads:` globs, budgets, merge order |

Related: `docs/harness/judge-rubric.md` (7 items scored 0-2; PASS = no blockers and total >= 11/14). `docs/harness/lessons.md` (<= 80 entries; **orchestrator is the only writer**).

## 5. Script CLIs

All scripts: Node >= 20 ESM (`.mjs`) except `check.ps1`. Exit codes: `0` ok, `1` check/rule failure, `2` usage error, `3` budget exceeded / escalate. `--json` prints machine-readable output.

```text
scripts/check.ps1 -Tier fast|full [-Scope <path[,path...]>]
    fast: rustfmt --check, clippy -D warnings, tsc --noEmit, biome, unit tests, docs-check
    full: fast + tauri build + golden replay tests
    A step whose project does not exist yet is skipped (reported as SKIP).

node scripts/harness/run-state.mjs init <run-id> --lane XS|S|M|L [--task <task-id>] [--wave <wave>]
node scripts/harness/run-state.mjs transition <run-id> <state>
node scripts/harness/run-state.mjs call <run-id> <role>          # counts a subagent call against budget
node scripts/harness/run-state.mjs status <run-id> [--json]
node scripts/harness/run-state.mjs claim <task-id> --owns <glob,...> [--reads <glob,...>] [--wave <wave>]
node scripts/harness/run-state.mjs release <task-id>
node scripts/harness/run-state.mjs wave <wave> status|budget

node scripts/harness/record-verdict.mjs --verdict PASS|FAIL --score <n> [--run <run-id>] [--report <path>]
    writes .harness/verdict.json with a fingerprint of the diff since the last checkpoint

node scripts/harness/docs-check.mjs [--json]
    event catalog <-> FioreEvent sync, codemap paths exist, new top-level modules listed,
    size limits (AGENTS.md <= 40 lines, role prompts <= 80, lessons <= 80), 30-day staleness warnings

node scripts/harness/ownership-check.mjs --branch <task/...> --task <task-id> [--base main]
    compares branch diff to claimed owns: globs; flags out-of-claim edits

node scripts/harness/metrics-report.mjs [--wave <wave>] [--json]
    summarizes .harness/metrics/*.jsonl for /retro (calls per lane, escalations, parallelism)

node evals/run.mjs [<task-id>] [--concurrency <n>]       # needs CURSOR_API_KEY in env
node scripts/dev/emit-event.mjs <event> [json]           # Phase 1
```

## 6. Ownership map conventions

- Each wave plan (`.harness/waves/<wave>.md`) gives every task `owns:` and `reads:` globs (repo-relative, forward slashes, `**` allowed).
- Executors edit only `owns:` paths. They never edit shared/contract files (codemap, spec, `FioreEvent` enum, registries, `reactions/index.ts`, `sensors/mod.rs`). A needed change there is reported as a **deviation**; integration applies it.
- `run-state.mjs claim` refuses a task whose `owns:` overlaps a running claim. The `subagentStart` hook enforces it.
- `ownership-check.mjs` runs at integration. Small deviations are accepted and logged; shared-file edits go back to the contract owner.
- One file per task for anything appended: handoff, metrics, run state. No shared append targets.
- Only the orchestrator writes `docs/harness/lessons.md`. Parallel agents return lesson candidates.

## 7. Naming conventions

- Task id: `<wave>-<slug>` lowercase kebab (e.g. `w20-music`). Run id: `<task-id>-<yyyymmddhhmmss>`.
- Branches: `task/<task-id>` (local worktree). The task id is already `<wave>-<slug>`, so `w20-music` is branch `task/w20-music`. `wip/<task-id>` (held back, pushed), `main` (checkpoints only).
- Tags: `p0-harness`, `p1-foundation`, `p2-mvp`, `v0.1.0`.
- Commits: conventional (`feat(music): ...`, `docs(harness): ...`, `chore: ...`). Checkpoint commits follow a judge PASS.
- Events: `dot.case` (`music.started`).

## 8. Git workflow (summary)

`main` receives only judged checkpoint commits and is pushed after each. Parallel tasks use local `task/*` worktree branches, deleted after merge. CI (`check.yml`, windows-latest) runs `check.ps1 -Tier full`. Evals never run in CI. `CURSOR_API_KEY` is read from the environment only. Hooks block force-push and pushes from `task/*` to `main`.
