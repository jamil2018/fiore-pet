// Category hold helper used by eval task fix-broken-debounce.
// Spec: emit the latest category only after it has been uninterrupted for >= 1500 ms.
// A category that changes and reverts inside that window emits nothing.
// Times are milliseconds. describeHold returns "HOLD" when nothing is emitted,
// otherwise the category name in upper case (CODING, WRITING, BROWSING, OTHER).
import { fileURLToPath } from "node:url";

const LABELS = { coding: "coding", writing: "writing", browsing: "browsing", other: "other" };

export function heldCategory(samples, now) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const latest = samples[samples.length - 1];
  if (!latest || typeof latest.category !== "string" || typeof latest.at !== "number") return null;
  if (!Number.isFinite(now)) throw new TypeError("now must be a finite number");
  const anchor = samples.find((sample) => sample.category === latest.category);
  const elapsed = now - anchor.at;
  if (elapsed >= 1500) return latest.category;
  return null;
}

export function describeHold(samples, now) {
  const category = heldCategory(samples, now);
  const label = LABELS[category];
  return label.toUpperCase();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = Number(process.argv[2] ?? "100");
  const samples = [{ at: 0, category: "coding" }];
  console.log(describeHold(samples, now));
}
