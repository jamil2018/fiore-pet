# Lessons

Purpose: short tagged rules learned from runs; the task packet includes only entries whose tags match the task.
last-verified: 2026-11-08

## Rules
- **Single writer:** only the orchestrator edits this file, during integration or `/ship` finish. Executor, debugger and judge return lesson candidates; they never write here.
- **Format:** one line per lesson, shaped `- [#tag1 #tag2] when <situation>, do <action>, because <reason> (<run-id>, <yyyy-mm-dd>)`. Template: `docs/harness/templates/lesson.md`.
- **Tags:** lowercase kebab with `#`, one to three per entry. Reuse existing tags before inventing new ones. Starter set: `#rust`, `#ts`, `#tauri`, `#windows-api`, `#sprites`, `#testing`, `#harness`, `#docs`, `#git`, `#windows-shell`.
- **Matching:** the orchestrator copies an entry into a packet when any of its tags matches the task's area (paths owned, reference docs used). No match means the packet says `none`.
- **Dedupe:** before appending, search for the same situation. Merge into the existing line (keep the oldest run id, add the newer one in parentheses) instead of adding a second line.
- **Cap:** at most 80 entries (`docs-check` warns above that). `/retro` compacts: merges near-duplicates, drops entries that a rule, doc or script now enforces, and keeps the newest evidence.
- **Be specific:** an entry must be actionable without extra context. Avoid taste, restatements of `docs/conventions.md`, and one-off facts.
- **Order:** newest at the bottom of the section below. Do not reorder; `/retro` rewrites the section when it compacts.

## Entries

<!-- No entries yet. The orchestrator appends below this line. -->

- [#sprites #ts] when the animator paints on the first frame, keep the bitmap from browserImageLoader on the merged animation, because loadAtlases only returned sizes and main.ts passes MergedAtlas alone (w11-render-20261108020000, 2026-11-08)
- [#sprites] when base.json already defines a body animation a later group also wants, move that key instead of adding it again, because a duplicate (layer, variant, animation) is a load error (w11-render-20261108020000, 2026-11-08)
- [#ts #engine] when switchEvent arms return different one-shot literals, pass switchEvent<Effect[]>, because inference locks every arm to the first animation literal (w11-engine-20261108020000, 2026-11-08)
- [#engine #reactions] when a reaction emits any effects for a step, skip builtin one-shots for that step, because a filled reaction would otherwise queue the same animation twice (w11-engine-20261108020000, 2026-11-08)
- [#tauri] when a second instance should reveal a hidden pet, call show() in the single-instance callback, because set_focus does not unhide and the window is created unfocused (w11-window-20261108015907, 2026-11-08)
- [#rust #testing] when a unit test installs a tracing subscriber, use tracing::subscriber::with_default and a temp file, because set_global_default sticks for the whole test process (w11-devtools-20261108015600, 2026-11-08)
- [#windows-shell] when a simulator must show up in GSMTC, play through Windows Media Player or WinRT MediaPlayer, because SoundPlayer never creates a media session (w11-devtools-20261108015600, 2026-11-08)
