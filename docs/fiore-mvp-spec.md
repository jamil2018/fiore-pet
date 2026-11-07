# Fiore MVP spec

Purpose: single source of truth for MVP scope, the event catalog, behavior priority and acceptance criteria.
last-verified: 2026-11-07

Nothing outside the event catalog triggers behavior. `docs-check` keeps the catalog table (section 3) in sync with the `FioreEvent` enum: every variant appears here, and every event here is a variant. Event names are `dot.case`; payload field names are camelCase on the wire.

## 1. Scope

**In MVP:** a small transparent, frameless, always-on-top window (hidden from taskbar) with a 32x32 pixel-art pet scaled 3x (96x96 px), tray menu (Show/Hide, Quit, Autostart toggle), single instance, and these reactions: fullscreen hide/appear, petting, app-activity props, music dance/headbob, time-of-day mood, seasonal outfit. Placeholder art ships; real art is a drop-in replacement (no code changes).

**Deferred (post-MVP):** typing-rate/caret tracking (counts only, never content), idle-to-sleep, CPU-load sweat, gaming detection, settings window, per-sensor toggles, art-generation role, test-first tester role.

## 2. Behavior resolution

Layers (all 32x32, aligned): `body`, `face`, `outfit`, `accessory`.

**Body animation priority, highest first** (a higher entry preempts lower ones; lower ones resume when it ends):
1. `hidden` (fullscreen active): no animation plays; sensors keep updating state.
2. `petting` (`pet.hover_start` .. `pet.hover_end`, including `happy` and afterglow)
3. one-shots (`notice`, `jump`, `stretch`, `yawn`, `twirl`, `appear`, `hide`, `wag`): play once, then return to the underlying state
4. activity (`coding`, `writing`, `browsing`)
5. music dance (only when activity is `other`)
6. idle/wander (`idle`, `walk`, `sit`)

- **Face** comes from mood (and `happy` while petted). **Outfit** comes from season. **Accessory** is headphones (music), or the activity prop (laptop, notepad, tablet); headphones take the accessory slot only while music plays, and activity props still show on the body animation.
- **Mood** changes face and animation speed only, never body choice.
- Animations: `idle`, `walk`, `sit`, `notice`, `dance`, `headbob`, `jump`, `code`, `think`, `write`, `browse`, `lean`, `happy`, `wag`, `hide`, `appear`, `stretch`, `yawn`, `twirl`.
- Window: only the pet region is visible; the window moves via `setPosition`; cursor hover over the sprite begins petting.
- On startup the hub sends `state.snapshot`; the engine initializes from it with no one-shots played.

## 3. Event catalog

Payload types: `Category = coding | writing | browsing | other`; `Mood = energetic | content | calm | sleepy`; `Season = winter | spring | summer | autumn`. Origin `rust` = emitted by a sensor via the hub; `ts` = emitted by frontend interaction code. The enum also contains `ts` events so `emit-event.mjs` and the debug panel can inject any event.

| Event | Payload | Origin |
|---|---|---|
| `state.snapshot` | `{ activity: Category, mood: Mood, season: Season, fullscreen: boolean, music: { playing: boolean, title?: string, artist?: string, sourceApp?: string } }` | rust (hub, on startup) |
| `fullscreen.entered` | `{}` | rust (`fullscreen.rs`) |
| `fullscreen.exited` | `{}` | rust (`fullscreen.rs`) |
| `pet.hover_start` | `{}` | ts (`interaction/petting.ts`) |
| `pet.stroke` | `{ direction: "left" \| "right" }` | ts |
| `pet.petted` | `{}` | ts |
| `pet.hover_end` | `{ wasPetted: boolean }` | ts |
| `app.category_changed` | `{ category: Category, process: string, title: string }` | rust (`foreground.rs`) |
| `music.started` | `{ title: string, artist: string, sourceApp: string }` | rust (`media.rs`) |
| `music.level` | `{ peak: number }` (0..1) | rust (`audio_peak.rs`) |
| `music.track_changed` | `{ title: string, artist: string }` | rust (`media.rs`) |
| `music.stopped` | `{}` | rust (`media.rs`) |
| `time.mood_changed` | `{ mood: Mood }` | rust (`clock.rs`) |
| `season.changed` | `{ season: Season }` | rust (`clock.rs`) |

### 3.1 Fullscreen (`sensors/fullscreen.rs`, `reactions/fullscreen.ts`)
- **Detection:** `SHQueryUserNotificationState` returns `QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN` or `QUNS_PRESENTATION_MODE`, **or** the foreground window rect equals its monitor rect. Desktop and shell windows are excluded. Emit only on state change.
- `fullscreen.entered` -> `hide` sequence: pet waves, dives down with a dust puff, fades out, window hides.
- `fullscreen.exited` -> `appear` sequence: pet pops up with a bounce, shakes off, resumes current state.
- While hidden, state keeps updating (activity, mood, season, music) but no animation plays.
- **AC-FS-1:** entered while idle plays `hide` once, then layers resolve to `hidden`.
- **AC-FS-2:** `app.category_changed`, `music.*` events received while hidden update state but produce no one-shots.
- **AC-FS-3:** exited plays `appear` once, then body equals what the current state would have produced without the hide.
- **AC-FS-4:** the pet's own window and the desktop/shell never count as fullscreen.

### 3.2 Petting (`interaction/petting.ts`, `reactions/petting.ts`)
- `pet.hover_start`: pointer enters sprite; pet looks up, eyes follow cursor.
- `pet.stroke`: a horizontal direction reversal of >= 12 px while hovering; pet plays `lean` toward the cursor; happiness rises.
- `pet.petted`: >= 3 strokes within 2 s; pet plays `happy` (eyes closed, purr, hearts) then a 1 s afterglow.
- `pet.hover_end`: back to previous state; if `wasPetted`, play `wag` first.
- **AC-PT-1:** 11 px reversal emits no stroke; 12 px emits one.
- **AC-PT-2:** 3 strokes in 2.0 s emit `pet.petted` once; 3 strokes over 2.5 s do not.
- **AC-PT-3:** petting outranks activity, music and idle, and is outranked only by `hidden`.
- **AC-PT-4:** `pet.hover_end { wasPetted: true }` plays `wag` once, then resumes the underlying state.
- **AC-PT-5:** only pointer position/direction is read; no keyboard APIs are used.

### 3.3 App activity (`sensors/foreground.rs`, `resources/app-categories.json`, `reactions/activity.ts`)
- **Detection:** poll foreground window every 500 ms; match process name first, then title keywords. A new category must hold for 1.5 s before `app.category_changed` is emitted. The pet's own window is ignored. Rules live in `app-categories.json`, not code.
- **coding** (`Code.exe`, `Cursor.exe`, `devenv.exe`, `idea64.exe`, `pycharm64.exe`, `sublime_text.exe`, `WindowsTerminal.exe`): tiny laptop, `code`, occasional `think`.
- **writing** (`notepad.exe`, `notepad++.exe`, `WINWORD.EXE`, `Obsidian.exe`, `Notion.exe`, plus browser titles containing "Google Docs", "Notion" or "Word"): notepad, `write`.
- **browsing** (`chrome.exe`, `msedge.exe`, `firefox.exe`, `brave.exe`, `opera.exe`, when no writing title rule matched): tablet, `browse`.
- **other:** idle behavior (wander, sit).
- **AC-AC-1:** `chrome.exe` + title "Doc - Google Docs" classifies `writing`; `chrome.exe` + title "News" classifies `browsing`.
- **AC-AC-2:** a category that changes and reverts within 1.5 s emits nothing.
- **AC-AC-3:** the pet's own process never produces a category change.
- **AC-AC-4:** unknown process classifies `other`.
- **AC-AC-5:** `app.category_changed` sets the matching animation/prop; `other` returns to idle/wander (or music dance if music is playing).

### 3.4 Music (`sensors/media.rs`, `sensors/audio_peak.rs`, `reactions/music.ts`)
- `music.started`: GSMTC session changes to Playing. Headphones appear, pet plays `notice`. If activity is `other` it plays `dance`; otherwise it keeps the activity animation and adds `headbob`.
- `music.level { peak }`: ~15 Hz while music plays (from `IAudioMeterInformation`); controls bob speed and amplitude; `peak > 0.8` occasionally triggers `jump`.
- `music.track_changed`: `notice` plus a speech bubble with the title for 3 s.
- `music.stopped`: emitted when nothing has played for 2 s; headphones come off.
- **AC-MU-1:** started with activity `other` -> `notice` then `dance` with headphones.
- **AC-MU-2:** started with activity `coding` -> `notice`, body stays `code`, `headbob` layered, headphones on.
- **AC-MU-3:** `music.level` events are ignored when music is not playing; `peak <= 0.8` never triggers `jump`.
- **AC-MU-4:** `music.track_changed` shows the bubble for 3 s (engine time), then clears it.
- **AC-MU-5:** `music.stopped` removes headphones and `dance`/`headbob`; a pause shorter than 2 s emits no `music.stopped`.
- **AC-MU-6:** no `music.level` events are emitted while music is stopped (sensor idle, CPU budget).

### 3.5 Mood and season (`sensors/clock.rs`, `reactions/mood.ts`, `reactions/season.ts`)
- `time.mood_changed`: checked once a minute; emitted on change. Mood changes face and animation speed only.
  - `energetic` 05-11: +20% speed, one `stretch` per day.
  - `content` 11-17: default face and speed.
  - `calm` 17-21: -15% speed.
  - `sleepy` 21-05: droopy eyes, `yawn` every 2-4 min, -30% speed.
- `season.changed`: checked at startup and at midnight; northern hemisphere by default (config flag flips it). First outfit change plays `twirl`.
  - `winter` Dec-Feb: scarf and beanie. `spring` Mar-May: flower crown. `summer` Jun-Aug: sunglasses and straw hat (glasses only while coding). `autumn` Sep-Nov: hoodie with leaf.
- A debug clock (env var `FIORE_FAKE_CLOCK`, ISO local time) overrides the system time so every mood and season is reachable.
- **AC-MS-1:** boundary hours map exactly (04:59 sleepy, 05:00 energetic, 10:59 energetic, 11:00 content, 17:00 calm, 21:00 sleepy).
- **AC-MS-2:** month boundaries map exactly (Nov 30 autumn, Dec 1 winter, Feb 28/29 winter, Mar 1 spring, Aug 31 summer, Sep 1 autumn); hemisphere flag flips them.
- **AC-MS-3:** mood never changes the body animation, only face and speed multiplier.
- **AC-MS-4:** `twirl` plays on the first outfit change after startup only, not on `state.snapshot`.
- **AC-MS-5:** `stretch` plays at most once per day; `yawn` only while `sleepy`.

### 3.6 Snapshot (`hub.rs`)
- `state.snapshot` is sent once on startup after all sensors registered, carrying current activity, mood, season, fullscreen and music state.
- **AC-SN-1:** replaying `state.snapshot` initializes layers (outfit from season, face from mood, accessory from music/activity) without playing any one-shot.

## 4. Cross-feature acceptance
- **AC-X-1:** priority order in section 2 holds for every pairwise combination (covered by cross-feature golden replay in W2.1).
- **AC-X-2:** a sensor that fails at startup is disabled; the app still runs and other sensors work.
- **AC-X-3:** every catalog event can be injected with `emit-event.mjs` and plays its documented reaction.

## 5. Non-functional
- **Performance:** idle CPU < 1%, RAM < ~60 MB. Poll rates: foreground 500 ms, audio peak ~15 Hz only while playing, clock 60 s, fullscreen <= 500 ms.
- **Privacy:** keystroke content is never read. Window titles and track names are logged only at `debug` level (logs are gitignored).
- **Resilience:** sensor failure is logged and that sensor disabled; the app never crashes. See `docs/architecture.md`.
- **Art:** 32x32 frames, 3x nearest-neighbor scale, atlas split per feature group (`base`, `activity`, `music`, `petting`, `fullscreen`, `outfits`, `faces`).
