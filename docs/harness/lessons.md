# Lessons

Purpose: short tagged rules learned from runs; the task packet includes only entries whose tags match the task.
last-verified: 2026-11-07

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
