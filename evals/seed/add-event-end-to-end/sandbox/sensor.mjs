// Sensor stub for eval task add-event-end-to-end.
// sample() is the one event this sensor emits.
export function sample() {
  return { type: "music.stopped", payload: {} };
}
