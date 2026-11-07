# ADR-0002: Layered sprites with per-feature atlases

Purpose: record why the pet is rendered as independent layers and why atlases are split per feature group.
last-verified: 2026-11-07

- **Status:** accepted
- **Date:** 2026-11-07

## Context
Body animation, face (mood), outfit (season) and accessory (headphones, props) vary independently. Pre-rendering every combination multiplies art (4 moods x 4 seasons x activities x music). Parallel feature tasks must also not conflict on one shared atlas file.

## Decision
Render four layers (`body`, `face`, `outfit`, `accessory`) on one 32x32 grid, scaled 3x with nearest-neighbor. Store art as one atlas per feature group (`public/sprites/<group>.png` + `.json`; `base`, `activity`, `music`, `petting`, `fullscreen`, `outfits`, `faces`); a loader merges them at startup.

## Alternatives
- **Full-frame sprites per combination:** combinatorial art explosion.
- **One monolithic atlas:** every feature edits the same PNG/JSON, causing merge conflicts in parallel waves.
- **Skeletal/vector animation:** not pixel-art, adds a runtime dependency.

## Consequences
- Mood and season are cheap to add; art can be replaced without code changes.
- All layers must share frame size and anchor; the atlas loader validates alignment (`docs/reference/sprite-atlas.md`).
- The engine selects per-layer animations by name constants, not pixel data.
- More draw calls per frame (4 layers); negligible at 32x32.
