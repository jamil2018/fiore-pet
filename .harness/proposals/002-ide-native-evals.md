---
id: 002
title: IDE-native evals
date: 2026-11-07
status: approved
---

files:
- .cursor/skills/eval/SKILL.md
- .cursor/skills/approve-proposal/SKILL.md
- .cursor/rules/harness.mdc
- docs/harness/README.md
- docs/harness/templates/eval-task.yaml

# Proposal 002: ide-native-evals

Purpose: drop API-key evals. The IDE subscription executes tasks; `evals/run.mjs` only grades.
last-verified: 2026-11-07

Approval note: user directive 2026-11-07: subscription-only evals.

## Problem and evidence
`evals/run.mjs` imported `@cursor/sdk` and refused to run without `CURSOR_API_KEY`. That bills API usage. Harness work already runs on the Cursor IDE subscription (`/ship`, Task, subagents). Evals should use that same path.

- W0.2 could not record a baseline: no API key, and `.harness/BOOTSTRAP` plus a placeholder baseline kept the eval gate waived.
- Seed tasks and hidden tests already exist under `evals/`. The grader can score a finished worktree, or dry-grade the seed fixtures, without an agent.

## Exact diff
Applied in the same commit as this proposal. Status is already `approved`, so `/approve-proposal` must not apply it again.

- `evals/run.mjs` prepares worktrees, grades a finished worktree (`--grade`), or dry-grades seed fixtures (`--offline-grade`). No `@cursor/sdk` import. No `CURSOR_API_KEY` read.
- `/eval` (`.cursor/skills/eval/SKILL.md`) runs each task through `/ship` in the IDE, then calls the grader.
- `evals/package.json` has no `@cursor/sdk` dependency.
- Baseline v0 is that offline grade: `status: recorded`, `method: offline-grade`, `mode: harness-ide`, `runner: ide`. Live pass/calls/rubric stay null until a later IDE `/eval` is approved. `.harness/BOOTSTRAP` is deleted so gates 2 and 3 enforce.

## Expected metric change
| Metric | Current | Expected |
|---|---|---|
| API-key requirement | required | none |
| Live baseline pass/calls/rubric | null (placeholder) | null until the first IDE `/eval` refresh |
| Eval gate | waived by BOOTSTRAP | enforced after this commit |

## Eval tasks to watch
- `docs-glossary-wave-budget`: stays XS, judge skipped, on the first live run.
- `config-lint-rules`: stays S with a judge score >= 11.
- `debug-mood-night`: stays S, calls the debugger, fixes the range check.

## Regression rule
If a later live eval regresses against `evals/baseline.json` once live metrics are recorded (pass becomes fail, calls up more than 30%, or rubric score drops), revert and mark the offending proposal `rejected`. v0 null live metrics are not a regression bar.
