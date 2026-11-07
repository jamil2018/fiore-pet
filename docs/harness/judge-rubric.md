# Judge rubric

Purpose: the scoring rules the judge applies once per task/wave, after all plan todos are done. Scripts decide what they can; the judge covers the rest.
last-verified: 2026-11-07

## Scoring
Seven items, each scored 0-2, total 14. **PASS = no blockers and total >= 11/14.** Any blocker is a FAIL regardless of score.

- 2 = fully met, with evidence.
- 1 = partly met; a gap that is fixable but not wrong.
- 0 = not met or violated.
- An item that the change cannot affect (for example performance on a docs-only change) scores 2 with evidence `n/a`.

| # | Item | 2 | 1 | 0 |
|---|---|---|---|---|
| 1 | Spec conformance | Behavior matches `docs/fiore-mvp-spec.md` (event names, payloads, priority stack, reactions) | Small deviation that does not change visible behavior | Contradicts the spec or invents behavior outside the event catalog |
| 2 | Tests cover acceptance criteria | Every criterion has a test or a documented manual check | Some criteria untested | Criteria unverified, or tests deleted/skipped to pass |
| 3 | Scope discipline | Only planned and claimed files changed | Minor logged deviations | Unlogged edits to shared/contract or harness files, or unrelated changes |
| 4 | Privacy | Keystroke content is never read; window titles and track names only at debug log level; nothing sent off-device | Title/track text logged at info level with no sensitive leak | Reads keystroke content, or logs/transmits private data |
| 5 | Performance | Sensor polling matches the spec (foreground 500 ms, audio peak ~15 Hz, clock 1/min); no busy loops; fits <1% idle CPU and ~60 MB RAM | A rate or allocation that is higher than needed | Unbounded polling, leaks, or per-frame work that breaks the budget |
| 6 | Readability and conventions | Follows `docs/conventions.md` (thiserror, tracing, no `unwrap` outside tests, strict TS, no `any`, `dot.case` events, comments only for non-obvious constraints) | A few convention slips | Pervasive violations, unexplained lint `allow`s, undocumented `unsafe` |
| 7 | Docs updated | Spec, codemap and other affected docs updated; no TODO without a `docs/backlog.md` entry | One stale or missing update | Docs contradict the code or `docs-check` fails |

## Finding severities
- `blocker`: forces rework. Use only for: spec violation, privacy violation, broken or missing acceptance criterion, failing `check full`, deleted/skipped tests, unlogged shared-file edits, crashes.
- `major`: real defect or gap. Fix only if the fix is quick; otherwise record in `docs/backlog.md`.
- `minor`: polish or small convention slip. Goes to `docs/backlog.md`; never triggers rework.

## Judge rules
- Review `git diff` against the last checkpoint, the plan, the spec, `docs/definition-of-done.md` and this rubric.
- Confirm each acceptance criterion with evidence (test name, command output, or a mock-mode screenshot for UI changes).
- Run `check full` read-only; do not fix anything.
- Taste-only observations are never blockers (at most `minor`).
- Do not raise the same finding a third time; if it persists after two review rounds, mark it `major` and escalate.
- Quick mode (XS lane): review the diff only; score items 1, 3, 6 and 7, and mark the rest `n/a` (counted as 2). Docs-only changes skip the judge.
- Output uses `docs/harness/templates/judge-report.md`; the verdict is recorded with `scripts/harness/record-verdict.mjs`.
