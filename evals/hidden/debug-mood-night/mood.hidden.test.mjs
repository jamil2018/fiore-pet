// Hidden grader for debug-mood-night. Copied into the eval worktree only after the agent run.
// Tests moodForHour directly, so a symptom patch in describeHour (try/catch, default string) fails here.
import assert from "node:assert/strict";
import test from "node:test";
import { describeHour, moodForHour } from "../sandbox/mood.mjs";

const EXPECTED = {
  energetic: [5, 6, 7, 8, 9, 10],
  content: [11, 12, 13, 14, 15, 16],
  calm: [17, 18, 19, 20],
  sleepy: [21, 22, 23, 0, 1, 2, 3, 4],
};

for (const [mood, hours] of Object.entries(EXPECTED)) {
  test(`moodForHour returns ${mood} for ${hours.join(",")}`, () => {
    for (const h of hours) assert.equal(moodForHour(h), mood, `hour ${h}`);
  });
}

test("every hour 0-23 maps to a mood", () => {
  for (let h = 0; h < 24; h++) assert.ok(moodForHour(h), `hour ${h}`);
});

test("describeHour works at night with the sleepy speed", () => {
  for (const h of [21, 23, 0, 3, 4]) assert.equal(describeHour(h), "sleepy (-30% speed)", `hour ${h}`);
});

test("daytime behaviour is unchanged", () => {
  assert.equal(describeHour(8), "energetic (+20% speed)");
  assert.equal(describeHour(13), "content (+0% speed)");
  assert.equal(describeHour(18), "calm (-15% speed)");
});

test("range validation is kept", () => {
  assert.throws(() => moodForHour(24), RangeError);
  assert.throws(() => moodForHour(-1), RangeError);
  assert.throws(() => moodForHour(1.5), RangeError);
});
