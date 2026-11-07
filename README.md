# Fiore

A tiny pixel-art desktop pet for Windows. Fiore lives on your desktop, reacts to what you do (coding, writing, browsing, listening to music, going fullscreen), and likes being petted.

**Status:** early development. Phase 0 (agent harness) is in progress; the app itself is not built yet.

## Stack

- Tauri v2 (Rust backend) + Vite + plain TypeScript frontend
- 32x32 pixel-art sprites, scaled 3x with nearest-neighbor
- Windows 10/11 only; ships as a standalone `.exe` and an NSIS installer

## Planned behavior

- Hides when an app goes fullscreen, reappears after
- Reacts to petting (hover, strokes)
- Changes activity by foreground app category
- Dances / headbobs to music playing in Windows
- Mood follows time of day; outfit follows the season

Privacy: Fiore never reads keystroke content, and logs are local-only.

## Repository

This repo is built with a multi-agent workflow (Cursor). See [docs/harness/README.md](docs/harness/README.md) for the harness contract and [docs/glossary.md](docs/glossary.md) for terminology.

Requirements for development (once the app lands): Rust (stable, MSVC), Node 20+, WebView2.

## License

Not yet specified.
