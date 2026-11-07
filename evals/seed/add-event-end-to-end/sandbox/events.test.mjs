import assert from "node:assert/strict";
import test from "node:test";
import { RUST_EVENTS } from "./events_rs.mjs";
import { TS_EVENTS } from "./events_ts.mjs";

function byName(list) {
  return new Map(list.map((entry) => [entry.name, entry.fields]));
}

test("rust and ts mirrors list the same events", () => {
  const rust = byName(RUST_EVENTS);
  const ts = byName(TS_EVENTS);
  assert.deepEqual([...rust.keys()].sort(), [...ts.keys()].sort());
  for (const [name, fields] of rust) {
    assert.deepEqual(ts.get(name), fields, name);
  }
});
