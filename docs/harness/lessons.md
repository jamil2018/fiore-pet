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
- [#harness #docs] when a contract step pre-creates fill-in stubs, tag them `[stub W<wave>, fill <task>]` in the codemap rather than `[planned]`, because docs-check warns on existing files that are still tagged planned (w10-contracts, 2026-11-08)
- [#rust #testing] when the hub folds sensor events and also accepts debug injection, give injection its own pass-through and test a repeat injection before the first sensor report, because sharing the fold turns injected events into snapshots (w10-contracts, 2026-11-08)
- [#ts #frontend] when the frame loop pauses because resolution.visible is false, still run that tick's render, mover.apply, and window.hide, because wander only switches to stay on the flip frame (w11-followup-20261108021500, 2026-11-08)
- [#engine #reactions] when an engine lands before per-feature reactions, freeze in the W2.0 contract which behavior stays in engine.ts, because later tasks cannot own behavior the engine already hard-codes (w11-judge, 2026-11-08)
- [#tauri #git] when a local full check sets FIORE_TAURI_ARGS=--no-bundle, run one default tauri build before the checkpoint, because CI bundles NSIS on every push to main (w10-contracts, 2026-11-08)
- [#harness #git] when closing a phase, record the judge verdict before the checkpoint tag, because tagging first leaves an unjudged commit that cannot be moved without a force-push (p0-harness, 2026-11-07)
- [#harness #windows-shell] when pwsh is not on PATH, run `powershell -File scripts/check.ps1` with the same arguments, because Windows PowerShell 5.1 runs that script and a missing pwsh is not a check failure (w11-render-20261108020000, w11-followup-20261108021500, 2026-11-08)
- [#sprites #testing] when a contract atlas test requires every sheet image to be `base.png`, validate each sheet against its own file before a task adds a group PNG, because that task cannot edit the shared test and `npm test` is project-wide (w20-app-category-20261108032600, w20-mood-season-20261108032300, w20-fullscreen-20261108032000, w20-petting-20261108032312, w20-music-20261108032500, 2026-11-08)
- [#golden #engine] when a golden pins yawn timing, skip the six reaction-stream draws before the first yawn delay, because `createEngine` consumes `config.rng` once per reaction before any yawn roll (w20-mood-season-20261108032300, 2026-11-08)
- [#rust #testing] when a test calls `unwrap_err` on `Result<T, E>`, derive `Debug` on `T`, because `unwrap_err` prints the `Ok` value (w20-app-category-20261108032600, 2026-11-08)
- [#ts #reactions] when `fullscreen.entered` clears the engine pet phase without `pet.hover_end`, reset the petting slice on that event, because a petting-tier facing would keep mirroring the pet after the gesture ends (w20-petting-20261108032312, 2026-11-08)
- [#rust #testing] when two sensors share `MUSIC_PLAYING`, take one test mutex in both modules, because `cargo test` runs them in parallel and the flag races (w20-music-20261108032500, 2026-11-08)
- [#engine #reactions] when several reactions share one `rng`, give each reaction its own seeded stream in the contract, because one feature's draws otherwise shift another feature's seeded goldens (w20-contract, 2026-11-08)
- [#sprites #harness] when a later wave splits sprite groups out of `base`, move the keys in the contract step and point the new group files at `base.png`, because otherwise every task needs `base.json` and the same key in two groups is a load error (w20-contract, 2026-11-08)
