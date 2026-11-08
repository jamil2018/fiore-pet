# W37 macOS sensor judge

Purpose: single source review of the macOS sensor and browser integration.
last-verified: 2026-11-08

Run: w37-macos-20261108. Base: aff1e72. Reviewed candidate: ef68a23.
Verdict: PASS. Score: 13/14. No blocking findings.

| Item | Score | Evidence |
|---|---:|---|
| Spec conformance | 2 | Existing catalog only; app debounce, music stop hold and frontend priorities retained. Native and browser scope/consent specified before implementation. |
| Acceptance coverage | 2 | Mac classifier/geometry/unknown-state tests; media permission-loss/regrant/fatal cleanup tests; opt-in meter lifecycle tests; actual browser probe tests; live Mac checklist documents remaining hardware/UI criteria. |
| Scope discipline | 2 | Ownership union passes all 29 changed files across four claims. Root contract/build/spec integration and empty-desktop correction are recorded deviations. |
| Privacy | 2 | No keystroke APIs, input fields, history or page text reads. Browser probe fixed and bounded; titles/metadata excluded from error logs. Capture is opt-in output-only scalar metering, with no retention/network path. |
| Performance | 1 | Worker polling and browser scan/time budgets are bounded; realtime callback uses atomic scalar state only. Interactive Mac CPU/RAM and device behavior remain unmeasured. |
| Conventions | 2 | Typed Rust errors, documented unsafe boundaries, malloc ownership guard, ARC native adapters, no added lint suppression. |
| Documentation | 2 | Spec, codemap, setup/permission guide, build workflow and manual checklist updated; published v0.2.0 remains explicitly separate. |

## Verification reviewed
- Windows full gate: .harness/w37-browser-full.log, all 10 stages PASS, including installer and golden replays.
- Actual browser probe: five Node VM tests PASS; no app launch needed.
- Ownership: .harness/w37-ownership.log PASS.
- Mac CI 42476786270: parent reports native clippy/tests/frontend and installed-browser dictionary checks passed; universal packaging is still in progress at review time.
- Reused the completed full gate at the parent's direction instead of duplicating the unchanged expensive build. No frontend change or native Mac surface is available to screenshot on this Windows host; pet stays closed as requested.

## Findings and limits
No actionable source defects identified. This verdict covers the reviewed implementation, not uncompleted artifact verification or a claim of live Mac feature parity. Before marking the task complete, the orchestrator must verify the universal build, architectures, signing, bundled usage descriptions and artifact provenance. Interactive permission dialogs, actual music apps/sites, display transitions, audio routes and idle resource use remain the documented Mac smoke checks.

Lesson candidates:
- [macos, privacy] Keep browser music integration in an explicitly enabled, fixed media-only probe; bounded public scripting avoids adding a local network listener.
- [rust, macos] Restrict OS-only adapter declarations to their consuming platform while retaining pure cross-platform logic tests.
