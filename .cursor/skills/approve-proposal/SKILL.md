---
name: approve-proposal
description: Apply a user-approved Fiore harness proposal from .harness/proposals/, run /eval, then keep the change (and propose a new baseline) or revert it and mark the proposal rejected. Use for `/approve-proposal <id>`.
disable-model-invocation: true
---

# /approve-proposal <id>

Applies `.harness/proposals/<id>-<slug>.md` (`id` = `NNN`). Contract: `docs/harness/README.md`. Evals: `/eval`.

## 1. Preconditions (stop if any fails)
- The user explicitly invoked this command for this id in this chat. A proposal merely existing, or `/retro` having written it, is **not** approval.
- Proposal front matter `status: proposed` (not already `applied` or `rejected`).
- `git status --short` shows no uncommitted changes to the files the diff touches (so revert is exact).
- Evals do not use an API key. `/eval` runs on the IDE subscription and `evals/run.mjs` only grades.

## 2. Apply
1. Read the proposal; list the files in its diff. Only harness files are allowed (`.cursor/agents|rules|skills|hooks*`, `docs/harness/*` except `lessons.md`). Anything else: stop and report.
2. Apply the **exact** diff (`git apply --check` first, then `git apply`); do not improvise or improve it. If it does not apply cleanly, stop and report; do not hand-merge.
3. Verify size limits still hold: `node scripts/harness/docs-check.mjs`. Failure -> revert (step 4) and mark rejected with reason.
4. Set front matter `status: approved`, and record `applied-files:` listing the touched paths. The stop hook's unapproved-harness-edit gate recognises an approved proposal id; include `proposal NNN` in any commit message that carries this change.

## 3. Evaluate
Run `/eval` (all tasks, not only the "watch" tasks): IDE `/ship` in each prepared worktree, then `node evals/run.mjs --grade`. Use the proposal's "eval tasks to watch" to focus the summary. No API key.

## 4. Decide
- **No regression** (no pass->fail, calls within +30%, rubric not lower): keep. Set `status: applied`, add the eval result file name and a one-line metric delta. Offer to update `evals/baseline.json` with the new results; update only if the user confirms. Commit only on request: `chore(harness): apply proposal NNN <slug>`.
- **Regression**: revert automatically and exactly, using only the recorded paths:
  ```powershell
  git apply -R .harness/proposals/<id>-<slug>.diff     # if the diff was saved separately
  # or: git checkout -- <applied-files>                # files were clean before step 2
  ```
  Never use `git reset --hard` (deny-listed). Set `status: rejected` with the regressed metric, task id and run id. Add a lesson candidate (tag `#harness`) for the next `/retro`; do not write `lessons.md` mid-flow unless you are the orchestrator at integration.

## 5. Report (<= 12 lines)
Proposal id/title, files changed, eval verdict with the moved metrics, final status (applied/rejected), baseline decision pending (if any).
