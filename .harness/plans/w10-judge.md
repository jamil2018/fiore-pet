# Judge report: w10-contracts

Purpose: re-judge of the W1.0 blocker fix, recorded at integration.
last-verified: 2026-11-08

- Run ID: `w10-contracts`
- Scope: w10-contracts
- Diff reviewed: `136657f..06bbc9d`
- Mode: quick (blocker path)
- `check full`: PASS (orchestrator packet, re-run on main after fast-forward)

## Verdict
**PASS** (score 13/14, blockers: 0, majors: 0, minors: 2)

## Rubric scores
| # | Item | Score (0-2) | Evidence (one line) |
|---|---|---|---|
| 1 | Spec conformance | 2 | Injected events update state and are forwarded unchanged (AC-X-3, rule d). |
| 2 | Tests cover acceptance criteria | 2 | `injected_state_event_passes_through_before_baseline` covers pass-through, repeats, and dedup. |
| 3 | Scope discipline | 2 | Hub and debug changes belong to the W1.0 contract task. |
| 4 | Privacy | 2 | No new logging of titles or track names. |
| 5 | Performance | 2 | n/a |
| 6 | Readability and conventions | 2 | Names and modules match the conventions. |
| 7 | Docs updated | 1 | `architecture.md` matches the pass-through; docs-check was not re-run by the judge. |
| | **Total** | **13/14** | |

## Acceptance criteria evidence
| Criterion | Met | Evidence (test name, command output, screenshot path) |
|---|---|---|
| AC-X-3 injected events reach `fiore://event` unchanged | yes | `Hub::inject` returns the original event; `injected_state_event_passes_through_before_baseline` |

## Findings
Severity: `blocker` (forces rework), `major` (fix only if quick), `minor` (goes to `docs/backlog.md`).

| Severity | file:line | Finding | Expected fix |
|---|---|---|---|
| minor | `src-tauri/src/hub.rs:118` | Named `_folded` discards the fold result. | `let _` or `drop`, or a one-line comment that the return is discarded on purpose. |
| minor | `src-tauri/src/debug.rs:21` | `debug::inject` shares a name with `Hub::inject`. | Rename `debug::inject` (for example to `forward_line`). |

## Lesson candidates
- `[hub][debug] when a pipeline has both a fold-and-deduplicate path and a debug-injection path, give injection its own message variant and test that a repeat injection before the first sensor report passes through unchanged, because sharing the sensor path turns injected events into snapshots`
