// Tiny text linter used by eval task config-lint-rules. Behaviour is driven entirely by lint.config.json.
//
// Rule config forms (ESLint style):
//   "rule-name": "off" | "warn" | "error"
//   "rule-name": ["warn" | "error", { ...options }]
//
// Rules: no-todo, max-line-length ({ max }), no-trailing-spaces, no-tabs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RULES = {
  "no-todo": (line) => (/\bTODO\b/.test(line) ? "TODO found" : null),
  "max-line-length": (line, opts) => (line.length > (opts?.max ?? 80) ? `line longer than ${opts?.max ?? 80}` : null),
  "no-trailing-spaces": (line) => (/[ \t]+$/.test(line) ? "trailing whitespace" : null),
  "no-tabs": (line) => (line.includes("\t") ? "tab character" : null),
};

function normalize(setting) {
  const [level, opts] = Array.isArray(setting) ? setting : [setting, undefined];
  return { level, opts };
}

export function lint(text, config) {
  const issues = [];
  const lines = text.split("\n");
  for (const [name, setting] of Object.entries(config.rules ?? {})) {
    const { level, opts } = normalize(setting);
    if (level === "off" || !RULES[name]) continue;
    lines.forEach((line, i) => {
      const message = RULES[name](line, opts);
      if (message) issues.push({ rule: name, level, line: i + 1, message });
    });
  }
  return issues;
}

export function loadConfig(url = new URL("./lint.config.json", import.meta.url)) {
  return JSON.parse(readFileSync(url, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node sandbox/lint.mjs <file>");
    process.exit(2);
  }
  const issues = lint(readFileSync(file, "utf8"), loadConfig());
  for (const i of issues) console.log(`${file}:${i.line} ${i.level} ${i.rule}: ${i.message}`);
  process.exit(issues.some((i) => i.level === "error") ? 1 : 0);
}
