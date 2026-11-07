---
name: ship
description: Classify a task into a lane (XS/S/M/L) and run it through the Fiore harness pipeline with run-state budgets, task packets, check, judge and checkpoint. Use for `/ship <task>` or any single task outside a wave.
disable-model-invocation: true
---

# /ship <task>

Single-task pipeline. For parallel multi-task work use `/wave` and `/integrate` instead. Contract: `docs/harness/README.md`. Terms: `docs/glossary.md`.

You are the **orchestrator**. Subagents start with no context; the task packet is all they see.

## 0. Respond directly (no pipeline)
Questions, explanations, and edits to docs/plans the user explicitly asked for need no run. Otherwise continue.

## 1. Intake: classify the lane
Pick the smallest lane that fits.

| Lane | Pick when | Flow | Budget |
|---|---|---|---|
| XS | docs/config/one-liner | executor, check | 3 |
| S | 1-3 files, no interface change | executor, check, judge | 5 |
| M | new feature or interface change | explorer(s) in parallel, planner, executor, check, judge | 10 |
| L | one whole phase | several M runs, one judge at the end | 25 |

Rules of thumb: touching `FioreEvent`, `Sensor`, atlas schema, registries or any shared/contract file means M at least. Docs-only XS skips the judge. When torn between two lanes, take the smaller; escalation handles under-sizing.

```powershell
$id = "<task-id>-$(Get-Date -Format yyyyMMddHHmmss)"   # task-id: <wave>-<slug>, lowercase kebab
node scripts/harness/run-state.mjs init $id --lane <XS|S|M|L> --task <task-id>
```

## 2. Build the task packet
Copy `docs/harness/templates/task-packet.md`. Fill it **once**:
- goal, lane, acceptance criteria (observable, testable)
- spec excerpts from `docs/fiore-mvp-spec.md` (only relevant lines)
- lessons from `docs/harness/lessons.md` whose tags match; `none` otherwise
- `Owns` / `Reads` globs; check command `pwsh scripts/check.ps1 -Tier fast -Scope <owned paths>`
- remaining budget

M lane: first read `docs/codemap.md` yourself; call at most the needed explorers (parallel), paste their path:line findings into the packet.

## 3. Run the states
Every state change and every subagent launch is recorded. Run from the main checkout.

```powershell
node scripts/harness/run-state.mjs transition $id plan      # M only; XS/S go straight to execute
node scripts/harness/run-state.mjs call $id planner         # BEFORE launching each subagent
node scripts/harness/run-state.mjs transition $id execute
node scripts/harness/run-state.mjs call $id executor
node scripts/harness/run-state.mjs transition $id check
pwsh scripts/check.ps1 -Tier fast -Scope <owned paths>
```

- Launch role subagents by name (`planner`, `executor`, `debugger`, `judge`, `explorer`; prompts in `.cursor/agents/`), passing the packet verbatim.
- M lane: planner returns the plan (`docs/harness/templates/plan.md`) saved to `.harness/plans/<task-id>.md`. Give the executor the plan todos in batches.
- Check fails: `transition $id debug`, `call $id debugger` (cap 3 attempts), then back to `check`. Formatting failures are fixed mechanically (autoformat hook), not by the debugger.
- The executor has 2 check attempts, then stops. Never launch a second executor to retry the same todo; use the debugger.
- If `run-state` rejects a transition, do not work around it. Exit code `3` or state `escalate` means **stop and report** to the user: lane, calls used, last failure, your best next step.

## 4. Judge (S, M, L; XS only quick-mode for non-docs)
After all plan todos are done and `check` passes (use `-Tier full` for M and L):
```powershell
node scripts/harness/run-state.mjs transition $id judge
node scripts/harness/run-state.mjs call $id judge
node scripts/harness/record-verdict.mjs --verdict PASS|FAIL --score <n> --run $id --report <path>
```
Judge runs **once**. Only `blocker` findings trigger rework (one debugger pass, then `check`; do not re-judge the same finding a third time). `major`: fix only if quick. `minor`: append to `docs/backlog.md` with the run id.

## 5. Finish
```powershell
node scripts/harness/run-state.mjs transition $id done
```
1. Append deduplicated lesson candidates from subagent reports to `docs/harness/lessons.md` (`docs/harness/templates/lesson.md` shape, tags, run id, date). You are the only writer; keep <= 80 entries.
2. On `main`, after judge PASS: conventional checkpoint commit (`feat(scope): ...`). On a `task/*` branch: gated by `check fast` only; no judge gate, no push.
3. Never `git push --force`; never push `task/*` to `main`. Commit/push only when the user asked for it or the phase flow requires a checkpoint.
4. Report: files changed, check result, verdict, calls used vs budget, lessons added.

## Handoff
Executor/debugger write `.harness/handoff/<task-id>.md` (`docs/harness/templates/handoff-entry.md`). Read it instead of re-exploring.
