# Lesson template

Purpose: one-line shape for entries in `docs/harness/lessons.md`. Only the orchestrator writes that file; other roles return candidates in this shape.
last-verified: 2026-11-07

## Format
```text
- [#tag1 #tag2] when <situation>, do <action>, because <reason> (<run-id>, <yyyy-mm-dd>)
```

## Rules
- One line per lesson, imperative, specific enough to act on without extra context.
- Tags are lowercase kebab with `#`; reuse existing tags (for example `#rust`, `#windows-api`, `#tauri`, `#ts`, `#sprites`, `#harness`, `#testing`).
- Merge duplicates instead of appending; keep the file at 80 entries or fewer (`/retro` compacts).
- The task packet includes only lessons whose tags match the task.

## Example
```text
- [#rust #windows-api] when calling WinRT async operations from a sensor thread, call `.get()` after initializing COM on that thread, because uninitialized COM returns RPC_E_CHANGED_MODE (w20-music-20261201120000, 2026-12-01)
```
