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

## Install

Windows 10/11. The NSIS installer (`Fiore_0.1.0_x64-setup.exe`) is per-user (no Administrator). It bootstraps WebView2 if the runtime is missing. A standalone `fiore.exe` is in the same release bundle.

Autostart is off by default. After install, the tray menu item **Start with Windows** writes a current-user Run key; unchecking it removes the key.

Silent install: `Fiore_0.1.0_x64-setup.exe /S`

## Uninstall

Use Windows Settings → Apps, or the uninstaller next to the installer. Uninstall removes the app files and the autostart Run value (`Fiore`) if it is still present. Leave **Start with Windows** unchecked if you are not using autostart.

## License

Not yet specified.
