# Plan: w36-release
last-verified: 2026-11-08

- Lane M, run w36-release-20261108; ship v0.2.0 accumulated pet improvements.
- Sync package/npm lock/Cargo lock/Tauri versions. Preserve prior user changes.
- macOS universal experimental preview: Tauri private transparency API, CoreGraphics primary mouse release detection, Start at login menu; existing Windows-only sensors explicitly unavailable. No full sensor port.
- Artifact-only GitHub Actions: Windows full check and NSIS/portable ZIP; macOS tests and universal app/DMG, ad-hoc signed. Archives and SHA256 tied to source SHA. Manual and codex/release-0.2.0 branch push triggers. No automatic public release publication.
- README and releasing guide list limitations and exact build steps. Root integrates spec/codemap as reported shared-file deviations.
- Acceptance: versions match, scoped fast/full and judge pass, remote artifacts are successful for both platforms; release tag and uploaded builds match checked SHA.
- Signing: no signing secrets configured; Windows unsigned, macOS ad-hoc and not notarized. Mac runtime smoke check unavailable from Windows host.
- Budget10 calls: planner, executor, judge; debugger only for failures, cap3. No unrelated edits or force pushes.
- Prior changes in src/public/scripts and architecture/reference docs are authorized accumulated work and included in shipping review/commit, though not new release edits.
- Planning correction: installed Tauri 2.12.1+ schema says macOSPrivateApi is a no-op; omit deprecated config/feature, following verified local reference. Use mac packaging override only.
- Candidate branch commits/push are needed to execute hosted macOS builds; main integration, release tag and public publication remain gated on review and both platform jobs.
