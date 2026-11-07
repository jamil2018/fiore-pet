---
name: retro
description: End-of-phase (or on-demand) Fiore retrospective: read metrics, run states, judge reports and lessons; compact lessons.md; write evidence-based harness proposals to .harness/proposals/. Use for `/retro`.
disable-model-invocation: true
---

# /retro

Self-evolution loop. Lessons are updated automatically; changes to agents, rules or skills are **proposals the user must approve** (applied by `/approve-proposal`). Contract: `docs/harness/README.md` sections 3-4.

## 1. Gather evidence
```powershell
node scripts/harness/metrics-report.mjs [--wave <wave>] --json
node scripts/harness/run-state.mjs status <run-id> --json     # for escalated / over-budget runs
node scripts/harness/run-state.mjs wave <wave> status
```
Also read: `.harness/runs/*.json`, judge reports (FAIL reasons, repeated findings), handoffs' lesson candidates, `docs/backlog.md`, `docs/harness/lessons.md`.

Key signals: calls per lane vs budget; escalations; debugger hit rate (fixed within cap); judge FAIL reasons; roles with the most rework; parallelism achieved per wave and critical-path wait.

## 2. Lessons (automatic, you are the only writer)
Edit `docs/harness/lessons.md` using `docs/harness/templates/lesson.md`: `[#tag ...] when X, do Y, because Z (run-id, date)`.
- Merge duplicates; keep the strongest evidence
- Drop lessons contradicted by newer runs or absorbed into a doc/rule
- Cap at **80 entries**; compact the oldest low-value ones first
- Tags must be specific (`#rust #windows-api #tauri #sprites #harness`) because task packets include only tag-matched lessons

## 3. Proposals (never self-apply)
Only when evidence shows a pattern (>= 2 occurrences, or one escalation with a clear cause). Number sequentially: next `NNN` after the highest in `.harness/proposals/`. Create `.harness/proposals/NNN-<slug>.md` from `docs/harness/templates/proposal.md`:

- **Problem and evidence**: run ids, metric numbers, finding text
- **Exact diff**: unified diff against `.cursor/agents|rules|skills|hooks.json` or `docs/harness/*`; no vague "improve prompt X"
- **Expected metric change**: which number moves and by roughly how much
- **Eval tasks to watch**: ids from `evals/tasks/`
- Front matter `status: proposed` (the user flips it to `approved` or says so in chat)

Prefer the smallest diff; at most 3 proposals per retro. Do not edit harness files directly. Do not propose changes that raise role prompts above 80 lines or `AGENTS.md` above 40.

## 4. Report (<= 20 lines)
Metrics summary per lane, escalations and causes, lessons added/removed/compacted (counts), proposals written (id, one-line title, expected effect), and anything the user must decide. Remind: approve with `/approve-proposal <id>`.
