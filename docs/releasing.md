# Releasing Fiore

Purpose: build, verify and distribute versioned Fiore release artifacts.
last-verified: 2026-11-08

## Platforms and signing

Windows 10/11 x64 is the full product. The portable ZIP contains `fiore.exe` and requires the WebView2 runtime. The per-user NSIS installer installs WebView2 if needed; it needs no Administrator. Autostart is off by default; **Start with Windows** toggles the current-user Run entry. Silent install accepts `/S`. Uninstall through Windows Settings → Apps removes app files and the Fiore autostart entry.

macOS is an experimental universal preview for Apple Silicon and Intel. It supports rendering, dragging, petting, clock moods, seasonal outfits and tray controls. Activity, media playback, audio-level and fullscreen sensors are Windows-only and unavailable in this preview. The tray's **Start at login** uses a LaunchAgent and is off by default. Disable it before deleting the app. Copy `Fiore.app` from the DMG or extracted ZIP into Applications before enabling it.

Windows binaries are unsigned. The Mac app is ad-hoc signed (`signingIdentity: "-"`) and not notarized; Gatekeeper may block it. For a build you trust, review macOS Privacy & Security's Open Anyway option. This is not a Developer ID distribution. No signing credentials or API keys are required by the workflow. A native Mac smoke check remains required before calling the preview runtime verified.

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
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --target universal-apple-darwin --bundles app,dmg
codesign --verify --deep --strict --verbose=2 src-tauri/target/universal-apple-darwin/release/bundle/macos/Fiore.app
lipo -archs src-tauri/target/universal-apple-darwin/release/bundle/macos/Fiore.app/Contents/MacOS/fiore
```

The architecture output must include `arm64` and `x86_64`. Bundles land under `src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`. Tauri automatically merges `tauri.macos.conf.json` on Mac. The locked Tauri 2.12.5 already enables its transparency API; the deprecated `macOSPrivateApi` flag and `macos-private-api` feature are unnecessary (verified in the installed CLI schema and Rust source).

## Artifact workflow and publication

[The release workflow](../.github/workflows/release.yml) runs manually or on pushes to `codex/release-0.2.0`. It has read-only repository permissions and never creates a release or tag. Windows runs the full quality gate; macOS runs native Rust tests, frontend tests/build and a universal build. Version 0.2.0 is synchronized across npm, Cargo and Tauri manifests and lockfiles.

Both jobs stage versioned archives/installers under `release-artifacts/<platform>/`, alongside `SOURCE_SHA-<platform>.txt` and `SHA256SUMS-<platform>.txt`. The uploaded artifact names contain the source commit SHA. Mac ZIPs use `ditto` to preserve the app's metadata and signature; the workflow verifies signing and both binary architectures before uploading.

Before publication, require successful jobs for the exact commit, download both artifact sets, verify their checksums and matching source SHA, and perform available native smoke checks (launch, transparent window, drag/release, petting, tray Show/Hide/Quit, single instance and autostart on/off). On Windows also check activity, music/audio and fullscreen reactions. If no interactive Mac is available, publish only as an experimental preview and explicitly disclose that native runtime smoke checks remain unverified. On Mac document any unverified runtime behavior as preview limitations. Tag that same checked commit as `v0.2.0`, then explicitly publish the versioned files and checksum/source manifests. Manifest filenames include `windows-x64` or `macos-universal` so they remain distinct when combined. Do not relabel artifacts built from another commit.

## API verification

The Mac drag-release query uses only the left mouse button in the current session, following Apple's [CGEventSourceButtonState](https://developer.apple.com/documentation/coregraphics/cgeventsource/buttonstate(_:button:)?language=objc) and [combined session state](https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid/combinedsessionstate) contracts. It shares the existing 30 ms wait interval and 120 second timeout and never reads keyboard or event contents.
