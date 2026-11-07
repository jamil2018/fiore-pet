import assert from "node:assert/strict";
import test from "node:test";
import { describeHour, moodForHour } from "./mood.mjs";

test("daytime moods", () => {
  assert.equal(moodForHour(5), "energetic");
  assert.equal(moodForHour(10), "energetic");
  assert.equal(moodForHour(11), "content");
  assert.equal(moodForHour(16), "content");
  assert.equal(moodForHour(17), "calm");
  assert.equal(moodForHour(20), "calm");
});

test("describeHour formats the speed change", () => {
  assert.equal(describeHour(8), "energetic (+20% speed)");
  assert.equal(describeHour(13), "content (+0% speed)");
  assert.equal(describeHour(18), "calm (-15% speed)");
});

test("out-of-range hours throw", () => {
  assert.throws(() => moodForHour(24), RangeError);
  assert.throws(() => moodForHour(-1), RangeError);
});
