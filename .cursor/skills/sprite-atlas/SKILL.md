---
name: sprite-atlas
description: Add or edit Fiore pixel-art animations and layers in per-group sprite atlases (public/sprites/<group>.png + .json), keep the 32x32 grid aligned across layers, and validate. Use when touching public/sprites/, the atlas loader, or adding an animation (idle, walk, dance, happy, hide, ...).
---

# Sprite atlas

Authority: `docs/reference/sprite-atlas.md` (JSON schema, layer alignment rules, how to add an animation). Follow its schema exactly; this skill only gives the workflow. Placeholder art ships first; the user may replace PNGs later with no code changes, so **never encode art-specific assumptions in code**.

## Model
- Layers: body, face, outfit, accessory. All share a **32x32 frame grid** and the same anchor, so any face/outfit frame composes over any body frame.
- Atlas is **split by feature group**: `public/sprites/<group>.png` + `<group>.json` (`base`, `activity`, `music`, `petting`, `fullscreen`, `outfits`, `faces`). The loader merges them at startup. A task edits only its own group files; never edit another group's atlas or a combined file.
- Render scale 3x with nearest-neighbor (`image-rendering: pixelated`, canvas `imageSmoothingEnabled = false`). Never smooth or fractional-scale.
- Animation names in use: `idle walk sit notice dance headbob jump code think write browse lean happy wag hide appear stretch yawn twirl`. Reuse names; unknown names are rejected by the engine mapping.

## Add or edit an animation
1. Read `docs/reference/sprite-atlas.md`; open an existing entry in your group's JSON as the template.
2. Draw frames on the 32x32 grid; sheet width/height must be multiples of 32; transparent background (RGBA PNG), no anti-aliased edges.
3. Add the frames to `<group>.png` and a matching entry to `<group>.json` (frame count, fps, loop vs one-shot, layer). One-shots (`notice`, `jump`, `hide`, `appear`, `twirl`, `stretch`, `yawn`) must not loop.
4. Wire behavior only through your owned reaction file (`src/behavior/reactions/<feature>.ts`). The engine, `reactions/index.ts` and `atlas` loader are shared/contract files: if a mapping there is missing, report a **deviation**.
5. Add a golden replay test stub: events in -> expected body/face/outfit/accessory layers out.

## Validate
Dimensions (PNG IHDR; width/height must be multiples of 32):
```powershell
node -e "const b=require('fs').readFileSync(process.argv[1]);const w=b.readUInt32BE(16),h=b.readUInt32BE(20);console.log(w+'x'+h, w%32===0&&h%32===0?'OK':'NOT multiple of 32')" public/sprites/<group>.png
```
Then:
```powershell
pwsh scripts/check.ps1 -Tier fast -Scope public/sprites,src/render
npm run dev:mock        # visual check in the browser; screenshot with the browser tool
```
Checklist: every JSON frame rect lies inside the PNG and on the 32 grid; every referenced animation name exists in the catalog list above; face/outfit/accessory frames align to the same anchor as `base` (toggle layers in the mock debug panel and look for jitter); loader test passes.

## Never
Hand-edit binary PNGs without regenerating the matching JSON; add a new animation name without the engine mapping going through a deviation; put sprite groups' content in one atlas to "save files".
