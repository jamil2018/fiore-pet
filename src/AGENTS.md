# Frontend rules (`src/**`)

Purpose: rules that apply only to the TypeScript frontend. Global rules live in `/AGENTS.md`.
last-verified: 2026-11-08

- Layout and naming: `docs/conventions.md` (TypeScript section). Module map: `docs/codemap.md`.
- Tests: `docs/testing.md` (Vitest, golden replay format).

## Hard rules
1. `tsconfig` is `strict`; no `any`, no non-null `!` without a comment. Biome must pass.
2. **Engine is pure.** `src/behavior/engine.ts` and `src/behavior/reactions/*` do no I/O, no DOM, no timers, no `Date.now()`, no `Math.random()`. Time and randomness come in through engine input (`now`, `rng`). This keeps golden replay deterministic.
3. **DOM work only in `src/render/`** (and the debug panel). Engine and reactions never touch `document` or `window`.
4. **Tauri imports only in `src/bridge/` and `src/interaction/mover.ts`.** Everything else receives events through the `Bridge` interface so mock mode works in a browser.
5. `src/events.ts` mirrors Rust `FioreEvent` exactly (names, payload fields, camelCase). It is a contract file: executors never edit it; report a deviation.
6. `src/behavior/reactions/index.ts` is a contract file (one stub per feature, pre-registered). Fill only your own `reactions/<feature>.ts`.
7. Layers are `body`, `face`, `outfit`, `accessory`; animation and atlas names come from the atlas JSON, never hard-coded strings scattered in code (use constants from `src/behavior/types.ts`).
8. Pixel art: nearest-neighbor only (`image-rendering: pixelated`, `imageSmoothingEnabled = false`), 48x48 at integer scale 2x (legacy 32x32 at 3x).
9. Petting reads pointer position and direction only. Never read keystrokes.
10. Every new behavior needs a golden replay case or a Vitest unit test derived from the spec's acceptance criteria.
