// Hidden grader for docs-glossary-wave-budget. Copied into the eval worktree only after the agent run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const text = readFileSync(new URL("../docs/glossary.md", import.meta.url), "utf8");
const rows = text.split("\n").filter((l) => l.startsWith("|"));
const cell = (row, i) => (row.split("|")[i + 1] ?? "").trim();
const idx = (term) => rows.findIndex((r) => cell(r, 0).toLowerCase() === term.toLowerCase());

test("Wave budget row exists exactly once", () => {
  assert.equal(rows.filter((r) => cell(r, 0).toLowerCase() === "wave budget").length, 1);
});

test("row is a well-formed two-cell table row", () => {
  const row = rows[idx("Wave budget")];
  assert.ok(row, "row missing");
  assert.equal(row.split("|").length, 4, "expected `| term | meaning |`");
  assert.ok(cell(row, 1).length > 20, "meaning too short");
});

test("meaning states the formula: sum of task budgets plus 4", () => {
  const meaning = cell(rows[idx("Wave budget")], 1).toLowerCase();
  assert.match(meaning, /sum/);
  assert.match(meaning, /task budget/);
  assert.match(meaning, /\b4\b|four/);
});

test("placed directly after the Budget row", () => {
  assert.equal(idx("Wave budget"), idx("Budget") + 1);
});

test("existing rows are untouched", () => {
  for (const term of ["Fiore", "Harness", "Lane", "Budget", "Churn", "Golden replay", "Simulator"]) {
    assert.ok(idx(term) >= 0, `row "${term}" was removed`);
  }
  assert.ok(rows.length >= 45, `table shrank (${rows.length} rows)`);
});
