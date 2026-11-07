---
id: 004
title: Phase 1 new-sensor and new-animation skills
date: 2026-11-08
status: approved
---

touches: .cursor/skills/new-sensor/SKILL.md, .cursor/skills/new-animation/SKILL.md
- .cursor/skills/new-sensor/SKILL.md
- .cursor/skills/new-animation/SKILL.md

# Proposal 004: new-sensor-animation-skills

Purpose: approve the Phase 1 scaffold skills already on main. Do not revert them.
last-verified: 2026-11-08

Approval note: user continuing Phase 1/W2 build after p1-foundation; skills were planned harness-ext deliverables (directive via continued build + stop-gate acknowledgments).

## Problem and evidence
The stop gate on main fired for the two skill files (eval gate and proposal gate). They landed in `cd99921` (`feat(harness): add Phase 1 skills and foundation evals`, tag context `p1-foundation`) after the baseline commit `136657f`. That range's only hook harness files are these two skills. `docs/harness/lessons.md` changed in the same commit and the hook excludes it. `docs/harness/README.md` did not change after the baseline commit, so there is no README path to list.

- Commit: `cd99921aae38deaac5b388fe55a369db6e073a9e` (2026-11-08).
- Hook proposal coverage: `status: approved` or `applied`, plus a `touches:` or `files:` list (`stop-gate.mjs` `approvedProposals`). An empty list would cover every harness file; this list is exactly the two skills.
- Hook eval freshness: mtime of `evals/baseline.json` (or any `evals/results/*.json`), compared with the harness file's commit time. It does not read `recorded` and it does not waive skills-only edits. An approved proposal does not clear the eval gate by itself.

## Exact diff
Already applied in `cd99921`. This proposal does not edit the skills and must not be applied a second time.

- `.cursor/skills/new-sensor/SKILL.md` (added)
- `.cursor/skills/new-animation/SKILL.md` (added)

## Expected metric change
| Metric | Current | Expected |
|---|---|---|
| Live pass / calls / rubric | null (offline v0) | null (unchanged) |
| Proposal gate on the two skills | unapproved | covered by proposal 004 |
| Eval freshness | skill commit newer than baseline mtime | baseline file rewritten; live metrics still null |

## Eval tasks to watch
- `add-event-end-to-end`: new-sensor scaffold; live metrics stay null until an IDE `/eval`
- `add-animation`: new-animation scaffold; same
- `config-lint-rules`, `debug-mood-night`, `docs-glossary-wave-budget`: null live metrics unchanged

## Regression rule
Null live metrics are not a regression bar. This watermark is not a live grade. If a later IDE `/eval` records live numbers and then regresses (pass becomes fail, calls up more than 30%, or rubric drops), revert the offending harness change and mark that proposal `rejected`.

## Eval gate note
Stop-gate does not allow an approved skills-only proposal to skip the eval gate. The gate clears when `evals/baseline.json` mtime is at least the skill commit time. `recorded` is updated so the file states that honestly. Task `pass`, `calls`, and `rubric` stay null. No agent metrics were invented.
