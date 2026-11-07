// Hidden grader for config-lint-rules. Copied into the eval worktree only after the agent run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lint, loadConfig } from "../sandbox/lint.mjs";

const config = loadConfig();
const sample = (name) => readFileSync(new URL(`../sandbox/samples/${name}`, import.meta.url), "utf8");
const levelOf = (setting) => (Array.isArray(setting) ? setting[0] : setting);

test("config enables the three rules at the requested levels", () => {
  assert.equal(levelOf(config.rules["no-todo"]), "error");
  assert.equal(levelOf(config.rules["max-line-length"]), "error");
  assert.equal(levelOf(config.rules["no-trailing-spaces"]), "warn");
  assert.deepEqual(Object.keys(config.rules).sort(), ["max-line-length", "no-todo", "no-trailing-spaces"]);
});

test("max-line-length limit is exactly 100", () => {
  const issues = (len) => lint("x".repeat(len), config).filter((i) => i.rule === "max-line-length");
  assert.equal(issues(100).length, 0);
  assert.equal(issues(101).length, 1);
  assert.equal(issues(101)[0].level, "error");
});

test("trailing spaces produce a warning, not an error", () => {
  const issues = lint("hello  ", config).filter((i) => i.rule === "no-trailing-spaces");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, "warn");
});

test("no-todo still errors", () => {
  const issues = lint("// TODO later", config).filter((i) => i.rule === "no-todo");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, "error");
});

test("long-line.txt is one line of 101 characters and is flagged", () => {
  const lines = sample("long-line.txt").replace(/\r?\n$/, "").split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 101);
  const issues = lint(lines[0], config).filter((i) => i.rule === "max-line-length");
  assert.equal(issues.length, 1);
});

test("clean.txt has two short lines and no issues at all", () => {
  const lines = sample("clean.txt").replace(/\r?\n$/, "").split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.length > 0 && l.length < 100));
  assert.deepEqual(lint(lines.join("\n"), config), []);
});
