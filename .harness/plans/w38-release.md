# v0.3.0 release

Purpose: merge reviewed Mac sensors into main and publish fresh Windows and Mac builds.
last-verified: 2026-11-08

Run w38-release-20261108, lane M, budget10 calls. Base44e5a65, branchcodex/release-0.3.0. Keep pet closed and unrelated files intact.

Executor owns package.json/package-lock.json, src-tauri/Cargo.toml/Cargo.lock/tauri.conf.json, .github/workflows/release.yml, README.md, docs/releasing.md, docs/reference/macos-sensors.md. Synchronize0.3.0 without dependency changes; release branch trigger; version-specific NSIS selection; Mac native fmt/clippy/tests/browser probe/dictionary/bundle permissions gates from existing Mac workflow. Update release docs, preserve signing/runtime limitations. Scoped fast max2 attempts.

Root owns spec scope integration, this plan, release notes/handoff and Git/release actions. No behavior/event changes. Root runs Windows full gate, pushes candidate for fresh release artifacts, verifies exactSHA/version/checksums. Prior hosted NSIS downloads failed HTTP504; if repeated, same-commit local full-gated Windows bundles may be used with explicit originmanifest/notes. No relabeling older artifacts.

Singlejudge aftergates; fast-forward main to verified candidate, tagv0.3.0 there, draftrelease/upload/verify serverdigests/publish. Ifmainmoves reconcileandrebuild. Existingrelease0.2.0untouched. Completeclaims/run andreportlinks. NativeMacruntimepermissions/devices remainmanualunverified, notCIproof.
