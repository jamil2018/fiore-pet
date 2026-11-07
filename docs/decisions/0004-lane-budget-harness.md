# ADR-0004: Lane and budget harness

Purpose: record why work is routed by size lanes with script-enforced budgets and objective gates.
last-verified: 2026-11-07

- **Status:** accepted
- **Date:** 2026-11-07

## Context
Multi-agent workflows waste calls on re-exploration, bounce-back loops and subjective review. The project needs predictable cost and a hard stop when a task goes wrong.

## Decision
- Route each task to the smallest lane: XS (3 calls), S (5), M (10), L (25); waves get the sum of task budgets plus 4.
- Run states (`intake`, `plan`, `execute`, `check`, `debug`, `judge`, `done`, `escalate`) are advanced through `scripts/harness/run-state.mjs`, which rejects illegal transitions and exits non-zero at a budget; hitting a cap means escalate to the user, never retry.
- Scripts decide pass/fail (`check.ps1`, `docs-check`); the judge reviews only what scripts cannot, once per task/wave, with a 14-point rubric (PASS: no blockers and >= 11).
- Roles are small with pinned models and fixed output templates; the orchestrator builds one task packet so roles do not re-explore.
- Lessons are appended automatically; prompt/rule/skill changes need user-approved proposals and an eval run (regression reverts).

## Alternatives
- **One generalist agent, no routing:** simple but costly and unpredictable on small tasks.
- **Convention-only budgets:** easy to ignore; the `subagentStart` hook plus script makes it enforceable.
- **Judge on every task:** high cost for little signal on docs/config changes.

## Consequences
- Predictable cost and a clear audit trail (`.harness/runs/`, `.harness/metrics/`).
- Some tasks escalate instead of finishing; that is intended.
- Lane misclassification is measured by evals and corrected through proposals.
- Harness changes are gated by evals against `evals/baseline.json`.
