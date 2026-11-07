import assert from "node:assert/strict";
import test from "node:test";
import { describeHold, heldCategory } from "./debounce.mjs";

test("a category held from the start emits at 1500 ms", () => {
  const samples = [{ at: 0, category: "coding" }];
  assert.equal(heldCategory(samples, 1499), null);
  assert.equal(heldCategory(samples, 1500), "coding");
});

test("describeHold formats a stable category", () => {
  const samples = [{ at: 0, category: "coding" }];
  assert.equal(describeHold(samples, 1500), "CODING");
});

test("empty input emits nothing", () => {
  assert.equal(heldCategory([], 5000), null);
});
