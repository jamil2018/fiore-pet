---
name: wave
description: Plan and launch one parallel Fiore wave: one planner call producing an ownership map, path claims, one git worktree per task, parallel executors, and wait for handoffs. Use for `/wave <phase>` (e.g. `/wave w20`) before `/integrate`.
disable-model-invocation: true
---

# /wave <wave>

Fan-out step of a wave (contract step -> **fan-out** -> integration). Contract: `docs/harness/README.md` sections 2, 6, 7. Integration is `/integrate`.

Precondition: the contract step for this wave is done and committed on `main` (shared files exist in final shape), and the tree is clean (`git status`). If not, stop and say so.

## 1. Explore (optional, parallel)
Read `docs/codemap.md`. Launch at most 2 `explorer` calls (one per area), in parallel, only for facts the codemap lacks.

## 2. Plan once
Launch **one** `planner` call for the whole wave. It returns `.harness/waves/<wave>.md` (shape: `docs/harness/templates/wave-plan.md`):
- wave id, tasks (`<wave>-<slug>`, lowercase kebab), merge order (dependency order, e.g. sensors before reactions)
- per task: `owns:` and `reads:` globs (repo-relative, forward slashes), lane, budget, acceptance criteria, verify command
- `owns:` sets must be disjoint; shared/contract files (codemap, spec, `FioreEvent`, registries, `reactions/index.ts`, `sensors/mod.rs`) are in nobody's `owns:`

Check the map yourself: any overlap or shared file in `owns:` -> send it back once; do not hand-edit around it.

## 3. Wave budget and claims
Wave budget = sum of task budgets + 4. Run from the **main checkout** (all `run-state` commands run here; executors never call it).

```powershell
node scripts/harness/run-state.mjs wave <wave> budget
node scripts/harness/run-state.mjs claim <task-id> --owns "<glob,glob>" --reads "<glob,...>" --wave <wave>
node scripts/harness/run-state.mjs init <task-id>-<yyyymmddhhmmss> --lane <lane> --task <task-id> --wave <wave>
```
A refused claim (overlap with a running task) means the task is deferred to the next wave; do not force it. Concurrency cap: **5 code agents** at once.

## 4. Worktree per task (code waves)
Docs/config-only waves share the main checkout (no worktrees; paths are disjoint). Code waves:

```powershell
git worktree add ../fiore-wt/<task-id> -b task/<task-id> main
pwsh scripts/setup-worktree-windows.ps1        # run inside the worktree: npm ci, sccache, per-worktree CARGO_TARGET_DIR
```
Branch naming: `task/<task-id>` (the id already includes the wave, e.g. `w20-music` is `task/w20-music`). Local only; never pushed by default.

## 5. Launch executors in parallel
For each task: build a task packet (`docs/harness/templates/task-packet.md`) once, with branch/worktree path, `Owns`/`Reads`, matching lessons, acceptance criteria, and `pwsh scripts/check.ps1 -Tier fast -Scope <owned paths>` to run **inside its worktree**.

```powershell
node scripts/harness/run-state.mjs call <run-id> executor     # per launch; the subagentStart hook also enforces budget/claims
node scripts/harness/run-state.mjs transition <run-id> execute
```
Launch all executors in **one batch** (parallel). Each returns changed files, check result, deviations, lesson candidates, and writes `.harness/handoff/<task-id>.md` (inside its worktree; it is local/ignored).

## 6. Wait and triage
Per task as results come in (other tasks keep going):
- check passed -> `transition <run-id> check` then leave for `/integrate`
- check failed after 2 attempts -> `transition <run-id> debug`, launch a `debugger` **in that task's worktree** (cap 3 attempts)
- budget hit or exit code 3 -> task `escalate`; release its claim, record it, continue the wave
- deviation needing a shared file -> note it in the wave file under "Deviations" for integration; do not let the executor edit it

Lesson candidates: collect, do not write `lessons.md` yet (integration does).

## 7. Hand off
```powershell
node scripts/harness/run-state.mjs wave <wave> status
```
Report to the user: tasks done/escalated, calls vs wave budget, deviations, worktree paths, and next command `/integrate <wave>`. Keep claims until `/integrate` releases them.
