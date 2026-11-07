# Definition of done

Purpose: the checklist the judge applies; scores map to `docs/harness/judge-rubric.md`.
last-verified: 2026-11-07

A task is done only when all of these hold:

1. **Checks pass:** `check full` passes (for task branches: `check fast -Scope <owned paths>`).
2. **Acceptance criteria covered:** every `AC-*` the task touches has an automated test or a documented manual check (`docs/testing.md`).
3. **Spec conformance:** behavior matches `docs/fiore-mvp-spec.md`; nothing outside the event catalog triggers behavior. The `FioreEvent` enum, TS mirror and spec catalog agree.
4. **Docs updated:** spec and `docs/codemap.md` reflect added/changed modules (via integration if they are contract files); `last-verified` bumped on edited docs.
5. **No orphan TODOs:** every `TODO(backlog)` has a `docs/backlog.md` entry with its source run.
6. **Scope discipline:** only claimed `owns:` paths changed; deviations are logged in the handoff; no harness files touched without an approved proposal.
7. **Privacy:** no keystroke content read; titles/track names logged only at `debug`; no secrets committed.
8. **Performance:** poll rates match the spec; no new busy loops; idle CPU < 1%, RAM < ~60 MB for sensor/render work.
9. **Robustness:** no `unwrap`/panic outside tests in Rust; sensor errors disable the sensor, never crash; engine never throws on input.
10. **Conventions:** `docs/conventions.md` followed; no lint suppression without a stated reason.
11. **Handoff written:** `.harness/handoff/<task-id>.md` with changed files, check result, deviations and lesson candidates.

Judge outcome: PASS = no blockers and total >= 11/14. Only blockers force rework; majors are fixed if quick; minors go to `docs/backlog.md`.
