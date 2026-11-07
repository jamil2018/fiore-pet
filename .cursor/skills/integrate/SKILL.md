---
name: integrate
description: Integration step of a Fiore wave: merge task branches in dependency order, run ownership-check and check full after each merge, route failures to the debugger, run the judge once, make the checkpoint commit, append lessons, and run retro. Use for `/integrate <wave>`.
disable-model-invocation: true
---

# /integrate <wave>

Serial integration. Contract: `docs/harness/README.md` sections 5-8. Inputs: `.harness/waves/<wave>.md` (merge order, owns), task branches `task/<task-id>`, handoffs, run states.

Run everything from the **main checkout on `main`** with a clean tree. Stop-hook gates (judge, eval, harness-change) apply here.

## 1. Preflight
```powershell
node scripts/harness/run-state.mjs wave <wave> status
git status --short
git branch --list "task/<wave>*"
```
Include only tasks whose run reached `check` passed. Escalated tasks are excluded up front. Read each task's `.harness/handoff/<task-id>.md` (in its worktree path if it lives there) for deviations.

## 2. Merge loop (merge order from the wave file)
For each branch, in order:

1. Ownership check (before merge):
   ```powershell
   node scripts/harness/ownership-check.mjs --branch task/<task-id> --task <task-id> --base main
   ```
   Small out-of-claim edits: accept and log under "Deviations". Edits to shared/contract files: do not merge as-is; apply the needed change yourself (you are the contract owner at integration) and drop it from the branch.
2. `git merge --no-ff task/<task-id>` (message `merge(<task-id>): ...`).
3. `pwsh scripts/check.ps1 -Tier full`.
4. Failure (merge conflict or check): launch one `debugger` (cap **2 attempts** for integration; `call <run-id> debugger`, `transition <run-id> debug`). Still failing -> undo the merge without `git reset --hard` (deny-listed): `git merge --abort` if mid-merge, or `git revert -m 1 <merge-sha>` if already committed. Then hold the branch back:
   ```powershell
   git push origin task/<task-id>:wip/<task-id>
   ```
   Mark the task for rescheduling alone in the next wave. The rest of the wave still merges.

## 3. Shared-file updates
Apply recorded deviations and wave-level edits that tasks may not make: `docs/codemap.md`, `docs/fiore-mvp-spec.md`, registries (`reactions/index.ts`, `sensors/mod.rs`), `FioreEvent` mirror. Then `pwsh scripts/check.ps1 -Tier full` once more. For Phase 2 waves also add cross-feature golden replay tests for priority interactions (hidden > petting > one-shots > activity > music dance > idle).

## 4. Judge once
```powershell
node scripts/harness/run-state.mjs call <wave-run-id> judge
node scripts/harness/record-verdict.mjs --verdict PASS|FAIL --score <n> --run <wave-run-id> --report .harness/plans/<wave>-judge.md
```
Launch `judge` on the merged result (diff vs last checkpoint). PASS needs no blockers and score >= 11/14. FAIL: one `debugger` pass on blockers only, `check full`, then a single re-judge. Still FAIL -> `escalate`: stop and report. Minors -> `docs/backlog.md`.

## 5. Checkpoint
1. Append lesson candidates from all handoffs/reports to `docs/harness/lessons.md` (dedupe, tags, run id, date, <= 80 entries; you are the only writer).
2. Checkpoint commit on `main` (conventional, e.g. `feat(music): ...` or `chore(wave): integrate <wave>`).
3. Phase-ending waves (W1.2, W2.1, W3.1): tag `p1-foundation` / `p2-mvp` / `v0.1.0`.
4. Push `main` (and the tag): `git push origin main --follow-tags`. Never force-push. Skip pushing if the user has not authorized pushes in this session; say so.
5. Cleanup merged tasks:
   ```powershell
   git worktree remove ../fiore-wt/<task-id>
   git branch -d task/<task-id>
   node scripts/harness/run-state.mjs release <task-id>
   ```

## 6. Retro
Run `/retro` (always at phase end; otherwise only if the wave had escalations or FAIL verdicts).

## 7. Report
Merged vs held-back tasks, check/judge results, deviations accepted, calls vs wave budget, lessons added, CI status after push, next wave.
