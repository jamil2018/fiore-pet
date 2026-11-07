# ADR-0001: Tauri v2 over Electron

Purpose: record why Fiore uses Tauri v2 (Rust + TypeScript) instead of Electron.
last-verified: 2026-11-07

- **Status:** accepted
- **Date:** 2026-11-07

## Context
Fiore is an always-running desktop pet that must idle under 1% CPU and ~60 MB RAM, ship as a standalone `.exe` plus NSIS installer, and call Windows APIs (GSMTC, audio meter, shell notification state, foreground window) from native code.

## Decision
Use Tauri v2: Rust backend (sensors, hub, window, tray) and a Vite + plain TypeScript frontend rendering to canvas.

## Alternatives
- **Electron:** larger memory footprint (bundled Chromium + Node), native APIs need N-API addons; misses the RAM/CPU budget.
- **Native Win32/WinUI only:** best footprint, but pixel-art rendering, fast iteration and browser-based mock mode become much harder.
- **Tauri v1:** superseded; v2 has the current window, tray and permission model.

## Consequences
- Windows APIs use the `windows` crate directly in Rust; sensors are testable behind traits.
- Frontend can run in a browser (`dev:mock`) so agents verify visuals without the real desktop.
- Contributors need Rust and Node toolchains; first cold build is slow (mitigated by sccache in worktrees).
- Tauri v2 specifics (capabilities, window config) must follow `docs/reference/tauri-v2.md`, not v1 knowledge.
