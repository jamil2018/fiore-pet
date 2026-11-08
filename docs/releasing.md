# Releasing Fiore

Purpose: build, verify and distribute versioned Fiore release artifacts.
last-verified: 2026-11-08

## Platforms and signing

Windows 10/11 x64 is the full product. The portable ZIP contains `fiore.exe` and requires the WebView2 runtime. The per-user NSIS installer installs WebView2 if needed; it needs no Administrator. Autostart is off by default; **Start with Windows** toggles the current-user Run entry. Silent install accepts `/S`. Uninstall through Windows Settings → Apps removes app files and the Fiore autostart entry.

macOS is an experimental universal preview for Apple Silicon and Intel. v0.3.0 adds native activity, fullscreen and music sensors to the pet's existing interactions. Supported music sources, permission setup, OS requirements and remaining runtime checks are owned by [the Mac sensor guide](reference/macos-sensors.md). The tray's **Start at login** uses a LaunchAgent and is off by default. Disable it before deleting the app. Copy `Fiore.app` from the DMG or extracted ZIP into Applications before enabling it.

The older v0.2.0 Mac preview lacks these sensors. [Mac sensor CI](../.github/workflows/macos.yml) continues to build separate universal development artifacts; release packages come from the versioned workflow below. Use a recent Xcode SDK with Core Audio tap declarations when building Mac bundles.

The [README installation notes](../README.md#installation) own the signing disclosure and user-facing SmartScreen/Gatekeeper instructions; link them from each release. The Mac build configuration uses `signingIdentity: "-"`, not a Developer ID identity. No signing credentials or API keys are required by the workflow. A native Mac smoke check remains required before calling the preview runtime verified.

## Brand icons

The shared source for the website, desktop app and installer icon is [the Fiore cat SVG](site/assets/fiore-icon.svg). Generate platform formats with `npx tauri icon docs/site/assets/fiore-icon.svg --output .harness/handoff/brand-icons`, then replace the matching files in `src-tauri/icons/`. Keep the generated mobile folders out of the desktop project. The bundle configuration uses these PNG, ICO and ICNS assets; the tray uses the default app icon. Rebuild packages to apply icon changes—already published downloads do not change automatically.

## Local builds

Use Node 22, stable Rust (at least the Cargo manifest's `rust-version`) and `npm ci`. Windows also needs the MSVC build tools and WebView2; macOS needs Xcode command-line tools.

Windows, from the repository root:

```powershell
npm ci
pwsh scripts/check.ps1 -Tier full
```

This produces `src-tauri/target/release/fiore.exe` and the installer under `src-tauri/target/release/bundle/nsis/`.

macOS, from the repository root:

```sh
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm test
node --test src-tauri/native/macos/browser_probe.test.mjs
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --target universal-apple-darwin --bundles app,dmg
codesign --verify --deep --strict --verbose=2 src-tauri/target/universal-apple-darwin/release/bundle/macos/Fiore.app
lipo -archs src-tauri/target/universal-apple-darwin/release/bundle/macos/Fiore.app/Contents/MacOS/fiore
```

The architecture output must include `arm64` and `x86_64`. Bundles land under `src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`. Tauri automatically merges `tauri.macos.conf.json` on Mac. The locked Tauri 2.12.5 already enables its transparency API; the deprecated `macOSPrivateApi` flag and `macos-private-api` feature are unnecessary (verified in the installed CLI schema and Rust source).

## Artifact workflow and publication

[The release workflow](../.github/workflows/release.yml) runs manually or on pushes to `codex/release-0.3.0`. It has read-only repository permissions and never creates a release or tag. Windows runs the full quality gate; macOS runs native formatting/lint/tests, browser probe and scripting-interface checks, frontend tests/build and a universal build. Version 0.3.0 is synchronized across npm, Cargo and Tauri manifests and lockfiles.

Both jobs stage versioned archives/installers under `release-artifacts/<platform>/`, alongside `SOURCE_SHA-<platform>.txt` and `SHA256SUMS-<platform>.txt`. The uploaded artifact names contain the source commit SHA. Windows staging selects the installer matching the manifest version, even when older installers remain in the build directory. Mac ZIPs use `ditto` to preserve the app's metadata and signature; the workflow verifies signing, both binary architectures, bundled version, Automation entitlement and permission descriptions before uploading.

Before publication, require successful artifact jobs for the exact commit, download both artifact sets, verify their checksums and matching source SHA, and perform available native smoke checks (launch, transparent window, drag/release, petting, tray Show/Hide/Quit, single instance and autostart on/off). Respect a user's instruction to keep the pet closed and disclose any resulting smoke-test gap. On Windows also check activity, music/audio and fullscreen reactions. If no interactive Mac is available, publish only as an experimental preview and explicitly disclose that native runtime smoke checks remain unverified. Tag that same checked commit as `v0.3.0`, then publish the versioned files and checksum/source manifests. Manifest filenames include `windows-x64` or `macos-universal` so they remain distinct when combined. Do not relabel artifacts built from another commit.

If hosted Windows packaging alone is blocked by an upstream NSIS download failure, a locally built Windows package from that exact source commit may replace the hosted artifact after the local full gate passes. Record the failure and local build evidence in `BUILD_ORIGIN-windows-x64.txt`, include its checksum, and disclose the origin in release notes. This is an explicit fallback, never a claim that the failed hosted job passed. Other test or compilation failures still block release. The Mac artifact must retain its successful native build and verification evidence.

## API verification

The Mac drag-release query uses only the left mouse button in the current session, following Apple's [CGEventSourceButtonState](https://developer.apple.com/documentation/coregraphics/cgeventsource/buttonstate(_:button:)?language=objc) and [combined session state](https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid/combinedsessionstate) contracts. It shares the existing 30 ms wait interval and 120 second timeout and never reads keyboard or event contents.
