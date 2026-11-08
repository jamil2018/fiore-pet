# Fiore

A tiny pixel-art desktop pet that reacts to your activity and likes being petted.
last-verified: 2026-11-08

[Visit the Fiore website](https://jamil2018.github.io/fiore-pet/) for downloads and a quick installation guide.

**Status:** v0.3.1. Windows 10/11 is the full product; macOS is an experimental universal preview. See the [release guide](docs/releasing.md) for build formats, installation, signing status and Mac limitations.

v0.3.1 aligns the app and installer icons with the website cat branding. v0.3.0 adds macOS activity, fullscreen, Apple Music/Spotify and opt-in browser media reactions. See [Mac sensor setup](docs/reference/macos-sensors.md) for permissions, browser coverage, audio-volume support and remaining runtime checks.

Fiore uses Tauri v2 (Rust), Vite and TypeScript, with 48x48 pixel-art sprites scaled 2x. Its reactions and platform scope are defined by the [MVP spec](docs/fiore-mvp-spec.md). Fiore never reads keystroke content, and logs are local-only.

## Installation

Download Fiore from the [official GitHub releases](https://github.com/jamil2018/fiore-pet/releases/latest). **Windows builds are unsigned; the experimental Mac build is ad-hoc signed and not notarized by Apple.** Security warnings are expected with these builds. Only proceed if you trust the source and the downloaded file. Each release includes SHA256 manifests for checking download integrity; checksums do not replace publisher signing.

### Windows 10/11 (x64)

1. Download and open the Windows setup `.exe`. Alternatively, extract the portable ZIP and run `fiore.exe` (requires WebView2).
2. If **Windows protected your PC** appears, select **More info**, then **Run anyway**, if available and you choose to trust this download. **Unknown publisher** is expected because Fiore has no code-signing certificate. This is a SmartScreen warning, not a Windows Firewall prompt.
3. Complete the per-user installation. The installer normally does not require Administrator access.

If your device's policy or Smart App Control prevents running the app and offers no exception, stop and contact your administrator. Do not disable Windows security or change firewall rules to install Fiore. See [Microsoft's explanation of SmartScreen reputation](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

### macOS (experimental universal preview)

1. Open the Mac DMG (or extract the Mac ZIP), then copy `Fiore.app` into **Applications**.
2. Try opening Fiore. Gatekeeper may report an unidentified developer or that Apple cannot check the app for malicious software.
3. If you trust this download and want to proceed, open **System Settings → Privacy & Security**, find the Fiore warning and choose **Open Anyway**, then confirm. On older macOS versions, use **System Preferences → Security & Privacy → General**. An administrator-managed Mac may not allow this exception.

Use only the app-specific exception described in [Apple's opening-apps guide](https://support.apple.com/en-us/102445); do not disable Gatekeeper or remove quarantine recursively. These steps address missing developer verification, not an alert that malware was detected or that the app is damaged. For those alerts, stop and report the exact message in [GitHub issues](https://github.com/jamil2018/fiore-pet/issues).

The preview still needs live Mac compatibility testing. Activity and music integrations may separately request permissions; follow the [Mac sensor setup guide](docs/reference/macos-sensors.md).

## Development

See the [release guide](docs/releasing.md#local-builds) for prerequisites and build commands. `npm run dev:mock` runs the browser preview; `npm run tauri dev` runs the desktop app. Run `pwsh scripts/check.ps1 -Tier fast` before handoff.

Repository workflow: [agent harness](docs/harness/README.md), [code map](docs/codemap.md), [terminology](docs/glossary.md).

## License

Not yet specified.
