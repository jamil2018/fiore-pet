# Fiore

A tiny pixel-art desktop pet that reacts to your activity and likes being petted.
last-verified: 2026-11-08

**Status:** v0.2.0. Windows 10/11 is the full product; macOS is an experimental universal preview. See the [release guide](docs/releasing.md) for build formats, installation, signing status and Mac limitations.

Development builds add macOS activity, fullscreen and Apple Music/Spotify reactions. See [Mac sensor setup](docs/reference/macos-sensors.md) for permissions, audio-volume support and remaining runtime checks.

Fiore uses Tauri v2 (Rust), Vite and TypeScript, with 48x48 pixel-art sprites scaled 2x. Its reactions and platform scope are defined by the [MVP spec](docs/fiore-mvp-spec.md). Fiore never reads keystroke content, and logs are local-only.

## Development

See the [release guide](docs/releasing.md#local-builds) for prerequisites and build commands. `npm run dev:mock` runs the browser preview; `npm run tauri dev` runs the desktop app. Run `pwsh scripts/check.ps1 -Tier fast` before handoff.

Repository workflow: [agent harness](docs/harness/README.md), [code map](docs/codemap.md), [terminology](docs/glossary.md).

## License

Not yet specified.
