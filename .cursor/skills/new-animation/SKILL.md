---
name: new-animation
description: Scaffold a Fiore atlas animation, the engine or reaction mapping, and a golden replay stub. Use when adding an animation under public/sprites/ or wiring a new body, face, outfit, or accessory animation. Schema and drawing rules stay in the sprite-atlas reference.
---

# New animation scaffold

Authority: `docs/reference/sprite-atlas.md` (schema, alignment, "Adding an animation"). Workflow for an existing group: `.cursor/skills/sprite-atlas/SKILL.md`. Golden file shape: `docs/testing.md`. Do not invent an animation name the spec does not use.

Edit only your group's `public/sprites/<group>.png` and `<group>.json`, your `reactions/<feature>.ts`, and a golden file the packet assigns to you. `src/render/atlas.ts`, `src/behavior/types.ts`, `src/behavior/engine.ts`, and `reactions/index.ts` are contract files. A missing name or mapping is a **deviation**.

Names already in `ANIMATIONS` (`src/behavior/types.ts`): `idle walk sit notice dance headbob jump code think write browse lean happy wag hide appear stretch yawn twirl`. Reuse one of these. A new name is a deviation that adds it to `ANIMATIONS` (and to `ONE_SHOTS` when `loop` is false).

## 1. Atlas animation
Append a row on the 32x32 grid in `<group>.png` (do not shift existing rows). Add the entry under that group's body or overlay sheet:

```json
"<name>": { "row": 0, "start": 0, "count": 4, "fps": 8, "loop": false }
```

`loop: false` for one-shots (`notice`, `jump`, `hide`, `appear`, `twirl`, `stretch`, `yawn`, `wag`). Body animations whose head moves also get `headOffset` with length `count`. Overlay sheets need `variant`. A second group must not repeat the same `(layer, variant, animation)` key.

## 2. Engine mapping
Prefer the reaction you own. The engine already skips its built-in one-shot when your reaction returns effects for that step.

```ts
import type { Effect } from "../types";

export function onExample(): Effect[] {
  return [{ kind: "oneShot", animation: "notice" }];
}
```

Use an `Animation` constant, not a new string. If `engine.ts` hard-codes the behavior your packet assigns to the reaction, report a deviation with this snippet. Do not edit `engine.ts` until the W2.0 contract step says the mapping lives there. Do not edit `reactions/index.ts`; it already registers each feature.

## 3. Golden stub
Add `src/behavior/golden/<name>.json`. `golden.test.ts` loads every `*.json` in that directory. Copy the `start` snapshot from an existing case (`docs/testing.md`).

```json
{
  "name": "ac_<id>_<behavior>",
  "start": {
    "now": 0,
    "seed": 1,
    "snapshot": {
      "activity": "other",
      "mood": "content",
      "season": "autumn",
      "fullscreen": false,
      "music": { "playing": false }
    }
  },
  "steps": [
    {
      "at": 0,
      "event": { "type": "<domain>.<name>", "payload": {} },
      "expect": { "body": "<animation>" }
    }
  ]
}
```

Set exactly one of `event` or `tick` per step. `expect` may include `body`, `face`, `outfit`, `accessory`, `overlay`, `speed`, `bubble`, `visible`, `move`.

## 4. Validate
```powershell
node -e "const b=require('fs').readFileSync(process.argv[1]);const w=b.readUInt32BE(16),h=b.readUInt32BE(20);console.log(w+'x'+h, w%32===0&&h%32===0?'OK':'NOT multiple of 32')" public/sprites/<group>.png
pwsh scripts/check.ps1 -Tier fast -Scope public/sprites/<group>.json,src/behavior/reactions/<feature>.ts,src/behavior/golden/<name>.json
```

Checklist: the frame rect sits on the 32 grid inside the PNG; `count >= 1` and `fps > 0`; the golden event is a catalog event; face, outfit, and accessory frames share the body anchor. Visual check is `npm run dev:mock`.
