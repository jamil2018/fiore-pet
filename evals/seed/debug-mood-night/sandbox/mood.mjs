// Time-of-day mood helper used by eval task debug-mood-night.
// Spec: energetic 05-11, content 11-17, calm 17-21, sleepy 21-05 (hours are 0-23, end exclusive).
// Speed factor (percent change): energetic +20, content 0, calm -15, sleepy -30.
import { fileURLToPath } from "node:url";

const SPEED_PERCENT = { energetic: 20, content: 0, calm: -15, sleepy: -30 };

export function moodForHour(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`hour must be an integer 0-23, got ${hour}`);
  }
  if (hour >= 5 && hour < 11) return "energetic";
  if (hour >= 11 && hour < 17) return "content";
  if (hour >= 17 && hour < 21) return "calm";
  if (hour >= 21 && hour < 5) return "sleepy";
}

export function describeHour(hour) {
  const mood = moodForHour(hour);
  const pct = SPEED_PERCENT[mood.toLowerCase()];
  return `${mood} (${pct >= 0 ? "+" : ""}${pct}% speed)`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(describeHour(Number(process.argv[2])));
}
