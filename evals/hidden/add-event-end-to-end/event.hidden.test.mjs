// Hidden grader for add-event-end-to-end. Copied in only after the agent run.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { RUST_EVENTS } from "../sandbox/events_rs.mjs";
import { TS_EVENTS } from "../sandbox/events_ts.mjs";
import { sample } from "../sandbox/sensor.mjs";

const NAME = "desk.lamp";
const FIELDS = { on: "boolean" };

test("catalog lists desk.lamp with a boolean on field", () => {
  const text = readFileSync(new URL("../sandbox/catalog.md", import.meta.url), "utf8");
  assert.match(text, /`desk\.lamp`/);
  assert.match(text, /on:\s*boolean/);
});

test("both mirrors agree on desk.lamp", () => {
  for (const list of [RUST_EVENTS, TS_EVENTS]) {
    const hit = list.find((entry) => entry.name === NAME);
    assert.ok(hit, `missing ${NAME}`);
    assert.deepEqual(hit.fields, FIELDS);
  }
});

test("sensor sample emits desk.lamp", () => {
  const event = sample();
  assert.equal(event.type, NAME);
  assert.equal(typeof event.payload?.on, "boolean");
});

test("existing catalog events stay on both mirrors", () => {
  for (const list of [RUST_EVENTS, TS_EVENTS]) {
    const names = list.map((entry) => entry.name);
    assert.ok(names.includes("state.snapshot"));
    assert.ok(names.includes("music.stopped"));
  }
});
