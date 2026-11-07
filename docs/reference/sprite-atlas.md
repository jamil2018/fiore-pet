# Sprite atlas reference (Fiore)

Purpose: the per-group atlas JSON schema, layer alignment rules, rendering rules and the recipe for adding an animation.
last-verified: 2026-11-08

Status: **frozen contract.** `src/render/atlas.ts` is the source of truth; this page matches it. Browser rendering facts are verified against MDN (see Sources); everything else is a Fiore design rule.

## 1. Files and groups

- One pair per feature group: `public/sprites/<group>.png` + `public/sprites/<group>.json`. The loader fetches every group listed in the loader's group list and **merges** them at startup. Features never edit each other's group files (this is what keeps parallel tasks conflict-free).
- All art is on a **32x32 pixel grid**, drawn at **3x** (96x96 px) with nearest-neighbor scaling.
- Groups, layer each group feeds, and the animations from the plan (indicative; the spec's reaction catalog decides which animation a reaction plays):

| Group | Layer | Animations |
|---|---|---|
| `base` | body | `idle`, `walk`, `sit`, `notice`, `jump`, `twirl`, `stretch`, `yawn` |
| `activity` | body, accessory | `code`, `think`, `write`, `browse`; props (laptop, notepad, tablet) |
| `music` | body, accessory | `dance`, `headbob`; headphones |
| `petting` | body | `lean`, `happy`, `wag` |
| `fullscreen` | body | `hide`, `appear` |
| `outfits` | outfit | seasonal outfits (scarf/beanie, flower crown, sunglasses/straw hat, hoodie/leaf) |
| `faces` | face | expressions per mood (energetic, content, calm, sleepy) |

Placeholder art ships first; replacing a PNG (same grid, same JSON) must need **no code change**.

## 2. Atlas JSON schema (version 1)

One JSON per group. A group may contain sheets for more than one layer, so layers are keyed inside the file.

```jsonc
{
  "version": 1,
  "group": "base",                       // must equal the file name stem
  "frame": { "w": 32, "h": 32 },         // grid cell; must be 32x32 in v1
  "sheets": [
    {
      "layer": "body",                   // body | outfit | face | accessory; variant forbidden on body
      "image": "base.png",               // relative to the JSON's directory
      "animations": {
        "idle": {
          "row": 0,                      // grid row in the PNG (0-based)
          "start": 0,                    // first column
          "count": 4,                    // number of frames (>= 1)
          "fps": 4,                      // playback rate at speed 1.0 (> 0)
          "loop": true,                  // false = one-shot, then returns to underlying state
          "headOffset": [[0,0],[0,0],[0,-1],[0,0]]   // optional, body only; see section 4
        },
        "jump": { "row": 5, "start": 0, "count": 6, "fps": 12, "loop": false }
      }
    }
  ]
}
```

TypeScript shape (mirror this in `src/render/`; no `any`):

```ts
type LayerName = "body" | "outfit" | "face" | "accessory";
interface AnimationDef {
  row: number; start: number; count: number; fps: number; loop: boolean;
  headOffset?: ReadonlyArray<readonly [number, number]>;
}
interface SheetDef { layer: LayerName; image: string; variant?: string; animations: Record<string, AnimationDef>; }
interface AtlasFile { version: 1; group: string; frame: { w: 32; h: 32 }; sheets: SheetDef[]; }
```

Field rules:

- `row`, `start`, `count` address whole grid cells: source rect for frame `i` is `x = (start + i) * 32`, `y = row * 32`, `w = h = 32`. No free-form rectangles in v1 (keeps alignment checkable).
- Animation names are lowercase single words from the registry in the spec/`FioreEvent`-adjacent animation list. Unknown names are a load error, not a warning.
- A **one-shot** (`loop: false`) must be a complete sequence that ends on a frame matching the idle pose, so the engine can cut back without a pop.
- Speed scaling (mood) multiplies `fps` at runtime; never bake mood speed into the JSON.
- `headOffset` length, when present, must equal `count`. Values are integer source pixels (never fractional). `headOffset` is body-only.
- `variant` is required for `face`, `outfit`, and `accessory`, and forbidden for `body`. Allowed names are the face, outfit, and accessory constants in `src/behavior/types.ts`.

### Merge rules (loader)

1. Key is `(layer, variant, animation)`. Body sheets use an empty variant. The same key defined in two groups is a **load error** (names a group collision instead of silently overriding).
2. `MergedAtlas.body(anim)` uses that body animation, otherwise body `idle`, and logs the fallback once. A missing group file is logged and skipped. Overlay `lookup` uses the named animation, otherwise the sheet's `"*"` entry.
3. Loader validates, at load: `version === 1`, `group` matches file, PNG `naturalWidth >= (start + count) * 32` and `naturalHeight >= (row + 1) * 32`, `count >= 1`, `fps > 0`. These checks are also what the `new-animation` skill and `check` should run against the files on disk.

## 3. Drawing and scaling rules (verified)

- Draw every layer onto **one canvas** sized to the 32x32 grid times the scale (96x96 CSS px), in fixed z-order: `body` (back), `outfit`, `face`, `accessory` (front). **[Fiore]** The z-order is a contract decision; change it only in `src/render/` and here together.
- Nearest-neighbor, per MDN:
  - Canvas 2D: set `ctx.imageSmoothingEnabled = false` (default is `true`, which blurs enlarged pixels). Reset it after any canvas resize, since changing `canvas.width/height` resets context state **[Fiore]** (standard canvas behavior, not on the cited page).
  - For `<img>`/CSS-scaled sprites: `image-rendering: pixelated` (nearest-neighbor to the nearest integer multiple, then smooth interpolation to the final size; keeps the look when the final size is not an integer multiple). `crisp-edges` is the other nearest-neighbor value; browsers show little difference. `image-rendering` has no effect on unscaled images.
- **[Fiore]** Scale is an integer constant (3). Draw at integer destination coordinates; never use fractional `x`/`y` or non-integer scale in `drawImage`. Window positions come from Rust/JS in pixels and are rounded before `setPosition`.
- **[Fiore]** Windows display scaling (125%, 150%) makes 3x CSS px a non-integer number of physical pixels. Test at 100%, 125% and 150% for uneven pixel widths. If visible, size the canvas backing store in physical pixels (`round(96 * devicePixelRatio)`) and scale the context by a whole number there.
- Rendering is DOM-confined: only `src/render/` touches canvas/DOM (see `src/AGENTS.md`).

## 4. Layer alignment rules

Goal: every layer overlays the body with zero drift, with no per-feature alignment code.

1. **Same grid, same origin.** Every sheet uses the identical 32x32 cell with the top-left of the cell as origin. The pet's feet rest on the same baseline row in every sheet (pick one baseline row in the art guide and keep it; `idle` frame 0 defines it). Overlays are authored on a 32x32 canvas with the body pose visible underneath, then exported without the body.
2. **Frame lockstep.** Layers advance on the body's frame clock. For a body animation `A` at frame `i`:
   - If the overlay sheet defines **the same animation name `A` with the same `count`**, draw its frame `i` (fully authored overlay, best for faces and props that move).
   - Otherwise if the overlay sheet defines the reserved name `"*"` (a static, single-frame, `count: 1` entry), draw that frame offset by the body frame's `headOffset[i]` (default `[0,0]`). This is how outfits and faces follow head bob without an overlay frame per body frame.
   - Otherwise, draw nothing for that layer and log at debug once. A missing overlay is not an error (e.g. no accessory while idle).
3. **Count mismatch is an error** when an overlay defines animation `A` with a `count` different from body `A` (it would desync). The loader reports both counts.
4. **Hidden accessories.** Accessories come and go by engine state (headphones on `music.started`, prop per activity). The atlas only provides frames; the engine decides presence.
5. **Z-order inside a layer** is the order of draw; props that go behind the body (a laptop on lap) must be on the `accessory` layer with art that already has the right cut-outs. There is no per-sprite z-index in v1.
6. **One-shots** play on the body; overlays follow the same rule (named match, else `"*"`). The face for a one-shot (e.g. `happy` eyes closed) comes from the `faces` sheet's animation of the same name, if the plan wants a face override; otherwise the mood face stays.
7. **Transparency.** PNG with 8-bit alpha; art uses only fully opaque or fully transparent pixels (no semi-transparent edges, so nearest-neighbor scaling stays crisp). Background must be fully transparent, never a key color.

## 5. Adding an animation (recipe)

Do this inside the group you own; do not edit another feature's group.

1. **Name it.** Add the animation to the spec's animation registry and the engine mapping through the contract owner if it is new (shared files are not yours to edit; report a deviation). Use an existing registry name if the animation is already planned.
2. **Draw the frames** on the 32x32 grid in `public/sprites/<group>.png`, appended as a new row (never reorder or shift existing rows; other code addresses them by `row`). Keep the baseline row.
3. **Describe it** in `public/sprites/<group>.json` under the right `sheets[].animations`:
   `{ "row": <new row>, "start": 0, "count": N, "fps": F, "loop": <bool> }` plus `headOffset` for body animations whose head moves.
4. **Overlays.** For each overlay layer that must change (face, outfit, accessory): add the same animation name with the same `count` in that layer's group, or rely on its `"*"` entry plus `headOffset`.
5. **Validate** (loader rules in section 2): PNG is wide/tall enough, counts match, `fps > 0`, no duplicate `(layer, animation)` across groups. Run `check fast -Scope public/sprites,src/render`.
6. **Test.** Add or extend a golden replay test (events in, expected `body/face/outfit/accessory` out) so the engine mapping to the new name is covered. The visual check is the mock-mode frontend (`npm run dev:mock`) plus a screenshot.
7. **Hand off.** List the new `(layer, animation)` keys, the group, and any engine-mapping or spec change you need in the handoff as a deviation; do not edit `docs/codemap.md` or the spec yourself.

Replacing existing art: keep the PNG dimensions' grid and the JSON keys; a pure PNG swap must not require code or JSON edits unless the frame count changes.

## 6. Common failures

| Symptom | Likely cause |
|---|---|
| Blurry/soft pixels | Smoothing left on (`imageSmoothingEnabled` not `false`), or a fractional scale/position |
| Pet shimmers or edges wobble | Fractional destination coordinates or non-integer physical-pixel scale (section 3) |
| Overlay floats a pixel off during `walk` | Body `headOffset` missing or wrong length; overlay using `"*"` without it |
| Startup error naming `(layer, animation)` | Duplicate key across groups, or engine references an unknown animation |
| Frames show the next row | `count` too large for the sheet width, or `start + count` exceeds columns |
| White/black box around the pet | Page background not transparent, or sprite PNG has an opaque background (see `tauri-v2.md` section 2) |

## Sources

- MDN `image-rendering`: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering (values `pixelated`, `crisp-edges`; no effect on unscaled images)
- MDN `CanvasRenderingContext2D.imageSmoothingEnabled`: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled (default `true`; set `false` to keep pixel art sharp)
- Plan: `fiore_desktop_pet` Phase 1 "Sprites" (32x32 grid, 3x nearest-neighbor, split groups, animation list) and `docs/glossary.md` (layer, atlas, one-shot)

Not from official docs (Fiore design, marked above): the JSON schema, merge rules, z-order, `headOffset`/`"*"` alignment mechanism, physical-pixel scaling advice. W1.0 may adjust these; if it does, update this page in the same change.
