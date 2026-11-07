// Hidden grader for add-animation. Copied in only after the agent run.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "../sandbox/engine.mjs";

const atlas = JSON.parse(readFileSync(new URL("../sandbox/atlas.json", import.meta.url), "utf8"));

function bodyAnimations(file) {
  const sheet = file.sheets.find((item) => item.layer === "body");
  assert.ok(sheet, "body sheet missing");
  return sheet.animations;
}

test("atlas keeps a 32 grid and idle", () => {
  assert.equal(atlas.version, 1);
  assert.equal(atlas.group, "base");
  assert.deepEqual(atlas.frame, { w: 32, h: 32 });
  assert.equal(atlas.sheets.length, 1);
  const idle = bodyAnimations(atlas).idle;
  assert.deepEqual(idle, { row: 0, start: 0, count: 4, fps: 4, loop: true });
});

test("wave is a one-shot on the next row", () => {
  const wave = bodyAnimations(atlas).wave;
  assert.ok(wave, "wave animation missing");
  assert.equal(wave.row, 1);
  assert.equal(wave.start, 0);
  assert.equal(wave.count, 4);
  assert.equal(wave.fps, 8);
  assert.equal(wave.loop, false);
  assert.ok(wave.count >= 1);
  assert.ok(wave.fps > 0);
});

test("engine maps pet.wave to wave and leaves other events on idle", () => {
  assert.deepEqual(resolve("pet.wave"), { body: "wave" });
  assert.deepEqual(resolve("state.snapshot"), { body: "idle" });
  assert.deepEqual(resolve("music.stopped"), { body: "idle" });
});

test("golden stub expects wave once", () => {
  const golden = JSON.parse(
    readFileSync(new URL("../sandbox/golden/wave.json", import.meta.url), "utf8"),
  );
  assert.equal(golden.name, "wave-once");
  assert.equal(golden.steps.length, 1);
  const step = golden.steps[0];
  assert.equal(step.at, 0);
  assert.equal(step.event.type, "pet.wave");
  assert.deepEqual(step.event.payload, {});
  assert.deepEqual(step.expect, { body: "wave" });
  assert.equal(step.tick, undefined);
});
