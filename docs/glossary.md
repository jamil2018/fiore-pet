# Glossary

Purpose: fixed meanings for shorthand used across Fiore docs, prompts and code.
last-verified: 2026-11-07

| Term | Meaning |
|---|---|
| Fiore | The desktop pet: Tauri v2 app (Rust + TypeScript), pixel art. |
| Harness | The multi-agent workflow: roles, lanes, budgets, gates, scripts, evals, lessons. |
| Phase | P0 Harness, P1 Foundation, P2 Reactions, P3 Ship. Each ends with judge PASS, checkpoint commit, tag, `/retro`. |
| Wave | A unit of work: contract step (serial), fan-out (parallel), integration (serial). Ids like `W1.1`. |
| Contract step | Serial step that freezes shared interfaces and pre-creates shared files. |
| Task | One parallel unit in a wave with its own owned paths (`w20-music`). |
| Lane | Size class (XS, S, M, L) that sets flow and call budget. |
| Budget | Max subagent calls for a run; exceeding it moves the run to `escalate`. |
| Run | One execution of the pipeline for a task, tracked in `.harness/runs/<run-id>.json`. |
| Run state | `intake`, `plan`, `execute`, `check`, `debug`, `escalate`, `judge`, `done`. |
| Escalate | Stop and report to the user; never retry past a cap. |
| Task packet | The only context a subagent receives (goal, lane, excerpts, lessons, paths, criteria, check command). |
| Role | planner, executor, debugger, judge, explorer. |
| Orchestrator | The main chat agent that routes, builds packets, advances run state, writes lessons. |
| Claim | Registered `owns:` paths for a running task; overlapping claims are refused. |
| `owns:` / `reads:` | Globs a task may edit / may only read. |
| Deviation | A needed change outside a task's claim, reported instead of made. |
| Handoff | Per-task note at `.harness/handoff/<task-id>.md`. |
| Check | `scripts/check.ps1`; `fast` (fmt, clippy, tsc, tests, docs-check) or `full` (adds build + golden replay). |
| Judge | Single review per task/wave against spec, definition of done and rubric. |
| Verdict | PASS/FAIL with rubric score; stored in `.harness/verdict.json` with a diff fingerprint. |
| Finding | Judge issue tagged `blocker`, `major` or `minor`. Only blockers force rework. |
| Checkpoint | Conventional commit on `main` after a judge PASS. |
| Lesson | Short tagged rule learned from a run, in `docs/harness/lessons.md`. |
| Proposal | User-approved change to agents/rules/skills, in `.harness/proposals/`. |
| Eval | Reproducible task run (pinned commit) that grades harness changes against `evals/baseline.json`. |
| Churn | Wasted calls/retries; the harness exists to minimize it. |
| Event | A typed `FioreEvent` (`dot.case`) produced by a sensor or interaction. |
| Sensor | Rust component implementing `Sensor` that emits events (media, audio_peak, foreground, fullscreen, clock). |
| Hub | Rust event hub that registers sensors and emits `fiore://event` to the frontend. |
| Bridge | Frontend event source: real Tauri bridge or mock bridge (`dev:mock`). |
| Snapshot | `state.snapshot` event sent by the hub on startup with current state. |
| BehaviorEngine | Pure TypeScript priority/layering resolver: events in, layer selection out. |
| Layer | Independent sprite channel: body, face, outfit, accessory. All share a 32x32 grid. |
| Atlas | Per-group sprite sheet (`public/sprites/<group>.png` + `.json`), merged by the loader. |
| One-shot | Non-looping animation that plays once then returns to the underlying state (e.g. `notice`, `jump`). |
| Activity | Foreground app category: `coding`, `writing`, `browsing`, `other`. |
| Mood | Time-of-day state: `energetic`, `content`, `calm`, `sleepy`. Affects face and speed only. |
| Season | `winter`, `spring`, `summer`, `autumn`; selects outfit. |
| Golden replay | Test feeding an event sequence and asserting resulting layers. |
| Mock mode | `npm run dev:mock`: UI in a browser with a fake bridge. |
| Simulator | Script in `scripts/dev/sim/` that reproduces a real condition (notepad, tone, fullscreen window). |
