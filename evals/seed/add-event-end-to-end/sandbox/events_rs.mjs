// Rust-shaped mirror for eval task add-event-end-to-end.
// Each entry is { name: "dot.case", fields: { fieldName: "boolean" | "string" | "number" } }.
export const RUST_EVENTS = [
  { name: "state.snapshot", fields: { activity: "string" } },
  { name: "music.stopped", fields: {} },
];
