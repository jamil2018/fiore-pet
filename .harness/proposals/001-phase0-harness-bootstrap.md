---
id: 001
title: Phase 0 harness bootstrap
date: 2026-11-07
status: pending
---

# Proposal 001: phase0-harness-bootstrap

Purpose: one-time approval for creating the initial harness during Phase 0 (W0.0 to W0.2). Shape: `docs/harness/templates/proposal.md`.
last-verified: 2026-11-07

## Problem and evidence
Chicken-and-egg: the stop gates demand an approved proposal and an eval run for harness edits, but Phase 0 is what creates the harness, the eval suite and its baseline.

- Phase 0 intentionally creates `.cursor/**`, `docs/harness/**`, `scripts/harness/**`, `evals/**`.
- `evals/baseline.json` started as a placeholder (`status: placeholder`, `recorded: null`). W0.2 records it without an API key (see Eval note and proposal 002).

## Scope
Creation and edits of the initial harness through W0.2:
- `.cursor/agents/`, `.cursor/rules/`, `.cursor/skills/`, `.cursor/hooks/`, `.cursor/hooks.json`, `.cursor/worktrees.json`
- `docs/harness/**` (except `lessons.md`, which the orchestrator owns)
- `scripts/harness/**`, `scripts/check.ps1`, `scripts/setup-worktree-windows.ps1`
- `evals/**`, `.harness/**`, `.github/workflows/`

## Exact intent
Approve the initial bootstrap only. Every harness edit after W0.2 needs its own new proposal and `/eval` run.

## Expected effect
The stop gates stop blocking Phase 0 completion. The hook waives the eval and proposal gates while bootstrap is active (see Eval note).

## Eval note
W0.2 records the first baseline without an API key. `node evals/run.mjs --offline-grade --write-baseline --yes` dry-grades the committed seed fixtures (`method: offline-grade`, `mode: harness-ide`, `runner: ide`). Live pass, calls, and rubric stay null until `/eval` grades a real IDE run and the user approves a refresh. After `recorded` is set, delete `.harness/BOOTSTRAP` so gates 2 and 3 enforce. See proposal 002. The checkpoint commit names proposal 002.

## Regression rule
Not applicable to the initial bootstrap; regressions are measured against the baseline W0.2 records.
