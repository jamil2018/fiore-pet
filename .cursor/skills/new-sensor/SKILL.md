---
name: new-sensor
description: Scaffold a Fiore sensor file, event stubs when a catalog variant is missing, the TypeScript mirror note, and a pure-logic test stub. Use when adding or filling src-tauri/src/sensors/*.rs or a new FioreEvent source. Win32 calls stay in the win32-sensor skill.
---

# New sensor scaffold

Authority: the event catalog in `docs/fiore-mvp-spec.md`. OS recipe: `.cursor/skills/win32-sensor/SKILL.md`. Tests: `docs/testing.md`. Do not invent an event the catalog does not list. Filling a W1.0 stub uses that stub file; do not add a second module for the same sensor.

Edit only the sensor file you own and its `#[cfg(test)]` module. `sensors/mod.rs`, `events.rs`, `src/events.ts`, the spec, and `reactions/index.ts` are contract files. A missing piece is a **deviation** (paste the stub); do not edit those files.

## 1. Sensor file
Create or fill `src-tauri/src/sensors/<name>.rs`:

```rust
use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct Reading {
    pub at_ms: u64,
}

pub struct <Name>Sensor;

impl Sensor for <Name>Sensor {
    fn name(&self) -> &'static str {
        "<name>"
    }

    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        let _ = tx;
        Ok(())
    }
}

/// Pure step. `now_ms` is injected. No OS calls and no sleep.
pub fn step(_reading: &Reading, _now_ms: u64) -> Option<FioreEvent> {
    None
}
```

Replace `<Name>` / `<name>`. Put classification, debounce, and thresholds in `step` (or more pure functions). `start` owns the thread, COM init, and the poll loop from the win32-sensor skill. Emit only catalog events, only on change, at the catalog rate.

## 2. Event stub (only if the variant is missing)
If `enum FioreEvent` has no variant for the catalog row, stop and report this deviation. Do not edit `events.rs`.

```rust
#[serde(rename = "<domain>.<name>")]
<Variant> { /* fields; rename_all_fields = "camelCase" is already on the enum */ },
```

Same deviation: add `src/behavior/golden/events/<domain>.<name>.json` (`{"type","payload"}`) and bump the fixture-count assertion in `events.rs` so it stays one file per catalog event.

## 3. TS mirror note
`src/events.ts` is the mirror, not a second catalog. When the variant is new, the same deviation adds:

- the `dot.case` string in `EVENT_TYPES`
- a union member `{ type: "<domain>.<name>"; payload: { /* camelCase */ } }`
- a `parseFioreEvent` arm (empty payloads are `{}`)
- a `switchEvent` arm in `src/events.test.ts`

Wire names stay camelCase (`sourceApp`, `wasPetted`). If the event is already in `EVENT_TYPES`, do not edit `events.ts`.

## 4. Test stub
In the same sensor file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ac_<id>_<behavior>() {
        let reading = Reading { at_ms: 0 };
        assert!(step(&reading, 0).is_none());
    }
}
```

One test per acceptance criterion. Drive `step` with an injected clock. Do not sleep, and do not call Win32.

## 5. Registration
`sensors/mod.rs` `all()` already lists the five W1.0 sensors. A brand-new sensor needs a deviation: `mod <name>;`, `Box::new(<name>::<Name>Sensor)` inside `all()`, and the uniqueness test updated. Do not edit `mod.rs`.

## 6. Verify
```powershell
pwsh scripts/check.ps1 -Tier fast -Scope src-tauri/src/sensors/<name>.rs
node scripts/dev/emit-event.mjs <domain>.<name> "<json>"
```
Handoff lists deviations and lesson candidates. Privacy: never read keystroke content; titles and track names only at `debug`.
