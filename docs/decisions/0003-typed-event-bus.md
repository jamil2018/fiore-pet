# ADR-0003: Typed event bus with a pure behavior engine

Purpose: record why all behavior flows through a typed `FioreEvent` catalog into a pure engine.
last-verified: 2026-11-07

- **Status:** accepted
- **Date:** 2026-11-07

## Context
Five sensors and the frontend petting detector must drive one pet without coupling. Behavior must be testable without Windows, audio or a real desktop, and agents need a way to trigger every reaction on demand.

## Decision
- All inputs are variants of one serde enum `FioreEvent` (`dot.case` names, camelCase payloads) mirrored as a TypeScript discriminated union, documented in the spec's event catalog.
- Sensors implement `Sensor`, send events to the hub, which emits `fiore://event`; the hub sends `state.snapshot` on startup.
- The `BehaviorEngine` is a pure function of `(state, event, now, rng)`; no I/O, DOM or timers.
- Nothing outside the catalog triggers behavior; `docs-check` keeps enum and catalog in sync.

## Alternatives
- **Frontend polls Tauri commands per sensor:** more IPC, no single replayable stream.
- **Shared mutable state store:** hard to test and to replay.
- **Untyped string/JSON events:** drift between Rust and TS goes unnoticed.

## Consequences
- Golden replay tests (events in, layers out) are the main behavior regression net.
- `emit-event.mjs`, the debug panel and mock bridge inject any event, so every reaction is manually triggerable.
- Adding behavior means adding an event to the catalog first (a contract change, done in a serial contract step).
- Frozen contracts let parallel tasks fill only their own files.
