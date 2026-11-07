// Sandbox engine for eval task add-animation.
// resolve(eventType) returns the body animation for that event.
export function resolve(eventType) {
  if (eventType === "state.snapshot") return { body: "idle" };
  return { body: "idle" };
}
