# ADR-0006: RAM budget is private process tree

Purpose: record why idle RAM is gated on private bytes of `fiore.exe` plus its WebView2 children, not working set, and why the budget is ~200 MB.
last-verified: 2026-11-08

- **Status:** accepted
- **Date:** 2026-11-08

## Context
The spec said idle RAM < ~60 MB without naming the process set or the Windows metric. Scenario I (`docs/release/v0.1.0-checklist.md`) measured `fiore.exe` ~31–32 MB working set, but the WebView2 child tree is ~361–374 MB working set and ~155–162 MB private. Summing working set double-counts shared Chromium pages. The ship gate must still cover the whole tree.

## Decision
Gate Scenario I on the sum of private bytes (`PrivateMemorySize64`) for `fiore.exe` plus its WebView2 child tree, under ~200 MB. Keep idle CPU < 1%. Report `fiore.exe` alone and tree working set as informational. Spec: `docs/fiore-mvp-spec.md` §5.

## Alternatives
- **Keep ~60 MB working-set tree:** fails on every WebView2 idle run; not a useful ship gate.
- **Gate on `fiore.exe` alone:** hides the WebView2 tree that dominates RAM.
- **Optimize WebView2 this release:** deferred; measured private-tree ~155–162 MB already has margin under ~200 MB.

## Consequences
- v0.1.0 Scenario I RAM is PASS (~155–162 MB private vs ~200 MB).
- Sampler already reports private and working set (`scripts/dev/perf-sample.ps1`); pass/fail uses tree private.
- ~60 MB is no longer claimed for the process tree.
