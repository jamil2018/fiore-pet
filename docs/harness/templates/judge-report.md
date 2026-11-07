# Judge report: <task-id or wave>

Purpose: judge output shape. Scores follow `docs/harness/judge-rubric.md`; severities and the PASS rule are defined there. Cap: ~60 lines.
last-verified: 2026-11-07

- Run ID: `<run-id>`
- Scope: <task-id | wave id>
- Diff reviewed: `<base>..<head>`
- Mode: full | quick (diff only)
- `check full`: PASS | FAIL | SKIP

## Verdict
**PASS | FAIL** (score <n>/14, blockers: <n>, majors: <n>, minors: <n>)

## Rubric scores
| # | Item | Score (0-2) | Evidence (one line) |
|---|---|---|---|
| 1 | Spec conformance | | |
| 2 | Tests cover acceptance criteria | | |
| 3 | Scope discipline | | |
| 4 | Privacy | | |
| 5 | Performance | | |
| 6 | Readability and conventions | | |
| 7 | Docs updated | | |
| | **Total** | **/14** | |

## Acceptance criteria evidence
| Criterion | Met | Evidence (test name, command output, screenshot path) |
|---|---|---|
| <criterion> | yes / no | <evidence> |

## Findings
Severity: `blocker` (forces rework), `major` (fix only if quick), `minor` (goes to `docs/backlog.md`).

| Severity | file:line | Finding | Expected fix |
|---|---|---|---|
| blocker | `<path>:<line>` | <what is wrong> | <what a correct change looks like> |

## Lesson candidates
- `[#tag] when X, do Y, because Z`  (or `none`)
