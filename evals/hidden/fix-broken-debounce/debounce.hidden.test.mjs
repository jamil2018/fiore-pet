// Hidden grader for fix-broken-debounce. Copied in only after the agent run.
// Calls heldCategory directly, so a symptom patch in describeHold (null check only) fails here.
import assert from "node:assert/strict";
import test from "node:test";
import { describeHold, heldCategory } from "../sandbox/debounce.mjs";

test("each category emits only after an uninterrupted 1500 ms", () => {
  for (const category of ["coding", "writing", "browsing", "other"]) {
    const samples = [{ at: 100, category }];
    assert.equal(heldCategory(samples, 1599), null, category);
    assert.equal(heldCategory(samples, 1600), category, category);
    assert.equal(describeHold(samples, 1600), category.toUpperCase(), category);
  }
});

test("a change that reverts inside the window emits nothing", () => {
  const samples = [
    { at: 0, category: "coding" },
    { at: 400, category: "browsing" },
    { at: 800, category: "coding" },
  ];
  assert.equal(heldCategory(samples, 2000), null);
  assert.equal(describeHold(samples, 2000), "HOLD");
});

test("the current run emits at its own 1500 ms boundary", () => {
  const samples = [
    { at: 0, category: "coding" },
    { at: 100, category: "browsing" },
  ];
  assert.equal(heldCategory(samples, 1599), null);
  assert.equal(heldCategory(samples, 1600), "browsing");
  assert.equal(describeHold(samples, 100), "HOLD");
});

test("an uninterrupted hold still formats CODING", () => {
  const samples = [{ at: 0, category: "coding" }];
  assert.equal(describeHold(samples, 1500), "CODING");
  assert.equal(describeHold(samples, 100), "HOLD");
});
