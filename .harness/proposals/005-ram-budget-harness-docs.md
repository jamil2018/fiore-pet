---
id: 005
title: Align harness RAM budget to private process tree
date: 2026-11-08
status: proposed
---

touches:
- docs/definition-of-done.md
- docs/harness/judge-rubric.md
- .cursor/skills/win32-sensor/SKILL.md

# Proposal 005: ram-budget-harness-docs

Purpose: point remaining harness ~60 MB RAM lines at spec §5 / ADR-0006. Do not apply until approved, then `/eval`.
last-verified: 2026-11-08

## Problem and evidence
Spec §5 and ADR-0006 now gate idle RAM on private bytes of `fiore.exe` plus WebView2 children, under ~200 MB. Three harness files still say ~60 MB:

- `docs/definition-of-done.md` item 8
- `docs/harness/judge-rubric.md` row 5
- `.cursor/skills/win32-sensor/SKILL.md` polling-rate bullet

Those files need an approved proposal + `/eval`. ADR-0001 was aligned in the same follow-up (docs decision, not a harness file).

## Exact diff
```diff
--- a/docs/definition-of-done.md
+++ b/docs/definition-of-done.md
@@
-8. **Performance:** poll rates match the spec; no new busy loops; idle CPU < 1%, RAM < ~60 MB for sensor/render work.
+8. **Performance:** poll rates match the spec; no new busy loops; idle CPU < 1%; idle RAM under the private-tree budget in `docs/fiore-mvp-spec.md` §5.
```

```diff
--- a/docs/harness/judge-rubric.md
+++ b/docs/harness/judge-rubric.md
@@
-| 5 | Performance | Sensor polling matches the spec (foreground 500 ms, audio peak ~15 Hz, clock 1/min); no busy loops; fits <1% idle CPU and ~60 MB RAM | A rate or allocation that is higher than needed | Unbounded polling, leaks, or per-frame work that breaks the budget |
+| 5 | Performance | Sensor polling matches the spec (foreground 500 ms, audio peak ~15 Hz, clock 1/min); no busy loops; fits <1% idle CPU and the private-tree RAM budget in spec §5 | A rate or allocation that is higher than needed | Unbounded polling, leaks, or per-frame work that breaks the budget |
```

```diff
--- a/.cursor/skills/win32-sensor/SKILL.md
+++ b/.cursor/skills/win32-sensor/SKILL.md
@@
-5. **Polling rate.** Use the catalog rate (e.g. foreground 500 ms, music level ~15 Hz, mood 1/min). Sleep between polls (`recv_timeout`/`sleep`), never busy-loop. Emit **only on change** (plus the periodic `music.level`). Perf budget: whole app idle < 1% CPU, < 60 MB.
+5. **Polling rate.** Use the catalog rate (e.g. foreground 500 ms, music level ~15 Hz, mood 1/min). Sleep between polls (`recv_timeout`/`sleep`), never busy-loop. Emit **only on change** (plus the periodic `music.level`). Perf budget: whole app idle < 1% CPU; RAM per `docs/fiore-mvp-spec.md` §5.
```

Bump `last-verified` on each touched doc to the apply date.

## Expected metric change
| Metric | Current | Expected |
|---|---|---|
| Live pass / calls / rubric | null (offline v0) | null (unchanged) |
| Proposal gate on the three files | unapproved | covered after user approval |

## Eval tasks to watch
- Any harness-doc or skill eval that quotes the idle RAM budget. Live metrics stay null until an IDE `/eval`.

## Regression rule
If any eval task regresses against `evals/baseline.json` (pass becomes fail, calls up more than 30%, or rubric score drops), revert automatically and mark this proposal `rejected`.
