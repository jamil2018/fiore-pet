#!/usr/bin/env node
// Keeps docs honest without an agent. CLI contract: docs/harness/README.md section 5.
//
//   docs-check.mjs [--json]
//
// Checks (a check whose inputs do not exist yet is reported as SKIP, never as a failure):
//   events     event catalog table in docs/fiore-mvp-spec.md <-> FioreEvent (src-tauri/src/events.rs)
//              and its TS mirror (src/events.ts)
//   codemap    every path in docs/codemap.md exists (entries tagged `[planned ...]` are skipped);
//              every top-level module in src/ and src-tauri/src/ is listed
//   sizes      AGENTS.md <= 40 lines, .cursor/agents/*.md <= 80, docs/harness/lessons.md <= 80 entries
//   staleness  docs older than 30 days (by `last-verified:`) while code changed since -> warning
//
// Exit codes: 0 ok (warnings allowed), 1 rule failure. Errors fail; warnings never do.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = 'docs/fiore-mvp-spec.md';
const CODEMAP = 'docs/codemap.md';
const RUST_EVENTS = 'src-tauri/src/events.rs';
const TS_EVENTS = 'src/events.ts';
const LIMITS = { agentsMd: 40, rolePrompt: 80, lessons: 80 };
const STALE_DAYS = 30;
const FILE_EXTS = new Set(['exe', 'json', 'ts', 'tsx', 'js', 'mjs', 'rs', 'md', 'mdc', 'png', 'yaml', 'yml', 'toml', 'html', 'css', 'ps1', 'log', 'txt', 'lock']);

const abs = (p) => join(ROOT, p);
const exists = (p) => existsSync(abs(p));
const read = (p) => readFileSync(abs(p), 'utf8');
const lineCount = (text) => {
  const l = text.split(/\r?\n/);
  if (l.length && l[l.length - 1] === '') l.pop();
  return l.length;
};
const checks = [];
function check(name, fn) {
  const c = { name, status: 'pass', errors: [], warnings: [], notes: [] };
  try {
    const r = fn(c);
    if (r === 'skip') c.status = 'skip';
    else if (c.errors.length) c.status = 'fail';
    else if (c.warnings.length) c.status = 'warn';
  } catch (e) {
    c.errors.push(`check crashed: ${e.message}`);
    c.status = 'fail';
  }
  checks.push(c);
}

// ---------- event catalog ----------

const DOT_NAME = /[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+/;
const isEventName = (s) => DOT_NAME.test(s) && !FILE_EXTS.has(s.split('.').pop());

function specEvents(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s.*event catalog/i.test(l));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const names = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    const m = lines[i].match(new RegExp(`^\\|\\s*\`(${DOT_NAME.source})\`\\s*\\|`));
    if (m && isEventName(m[1])) names.add(m[1]);
  }
  return names;
}

function enumBody(text, enumName) {
  const m = new RegExp(`enum\\s+${enumName}\\s*\\{`).exec(text);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
  }
  return text.slice(start, i - 1);
}

function rustEvents(text) {
  const body = enumBody(text, 'FioreEvent');
  if (body === null) return null;
  const renamed = [...body.matchAll(new RegExp(`"(${DOT_NAME.source})"`, 'g'))].map((m) => m[1]).filter(isEventName);
  if (renamed.length) return new Set(renamed);
  // No serde renames: derive `namespace.rest_of_name` from CamelCase variants (MusicTrackChanged -> music.track_changed).
  const clean = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/#\[[^\]]*\]/g, '');
  const segments = [];
  let depth = 0;
  let cur = '';
  for (const ch of clean) {
    if (ch === '{' || ch === '(') depth++;
    else if (ch === '}' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      segments.push(cur);
      cur = '';
    } else cur += ch;
  }
  segments.push(cur);
  const names = new Set();
  for (const seg of segments) {
    const m = seg.trim().match(/^([A-Z][A-Za-z0-9]*)/);
    if (!m) continue;
    const words = m[1].match(/[A-Z][a-z0-9]*/g) ?? [m[1]];
    if (words.length < 2) continue;
    names.add(`${words[0].toLowerCase()}.${words.slice(1).join('_').toLowerCase()}`);
  }
  return names;
}

function tsEvents(text) {
  const clean = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const m of clean.matchAll(new RegExp(`['"\`](${DOT_NAME.source})['"\`]`, 'g'))) {
    if (isEventName(m[1])) names.add(m[1]);
  }
  return names;
}

function diffSets(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

check('events', (c) => {
  if (!exists(SPEC)) {
    c.notes.push(`${SPEC} not found`);
    return 'skip';
  }
  const spec = specEvents(read(SPEC));
  if (spec === null) {
    c.errors.push(`${SPEC} has no "Event catalog" heading`);
    return;
  }
  if (spec.size === 0) c.errors.push(`${SPEC}: event catalog table has no events (rows must start with | \`dot.name\` |)`);
  c.notes.push(`spec catalog: ${spec.size} events`);

  const compare = (label, set) => {
    for (const e of diffSets(set, spec)) c.errors.push(`${label} has event "${e}" missing from the spec catalog`);
    for (const e of diffSets(spec, set)) c.errors.push(`spec catalog lists "${e}" but ${label} has no such variant`);
  };

  let compared = 0;
  if (exists(RUST_EVENTS)) {
    const rust = rustEvents(read(RUST_EVENTS));
    if (rust === null) c.errors.push(`${RUST_EVENTS} has no \`enum FioreEvent\``);
    else {
      compare('FioreEvent (rs)', rust);
      compared++;
    }
  } else c.notes.push(`${RUST_EVENTS} not found, skipped`);
  if (exists(TS_EVENTS)) {
    const ts = tsEvents(read(TS_EVENTS));
    compare('FioreEvent (ts)', ts);
    compared++;
  } else c.notes.push(`${TS_EVENTS} not found, skipped`);
  if (compared === 0 && c.errors.length === 0) return 'skip';
});

// ---------- codemap ----------

const GLOB_CHARS = /[*?<>{}]/;

function hasRealFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.gitkeep') continue;
    if (e.isFile()) return true;
    if (e.isDirectory() && hasRealFiles(join(dir, e.name))) return true;
  }
  return false;
}

function topLevelModules() {
  const out = [];
  for (const base of ['src', 'src-tauri/src']) {
    if (!exists(base)) continue;
    for (const e of readdirSync(abs(base), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (/\.(test|spec)\.tsx?$|\.d\.ts$|\.md$/.test(e.name)) continue;
      const rel = `${base}/${e.name}`;
      if (e.isDirectory() && !hasRealFiles(abs(rel))) continue;
      if (e.isFile() || e.isDirectory()) out.push(rel);
    }
  }
  return out;
}

check('codemap', (c) => {
  if (!exists(CODEMAP)) {
    c.notes.push(`${CODEMAP} not found`);
    return 'skip';
  }
  const text = read(CODEMAP);
  let listed = 0;
  let planned = 0;
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    const m = line.match(/^\s*[-*]\s+`([^`]+)`/);
    if (!m) continue;
    const p = m[1].trim();
    if (!p.includes('/') || /^https?:/.test(p) || GLOB_CHARS.test(p)) continue;
    listed++;
    const isPlanned = /\[planned\b/i.test(line);
    const present = exists(p.replace(/\/$/, ''));
    if (isPlanned) planned++;
    if (!present && !isPlanned) {
      c.errors.push(`${CODEMAP}:${idx + 1}: path "${p}" does not exist (tag the entry \`[planned W<wave>]\` if it is not created yet)`);
    } else if (present && isPlanned) {
      c.warnings.push(`${CODEMAP}:${idx + 1}: "${p}" exists but is still tagged [planned]; remove the tag`);
    }
  }
  c.notes.push(`codemap: ${listed} path entries (${planned} planned)`);

  for (const mod of topLevelModules()) {
    const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`${esc}(?=[/\`\\s:.,)]|$)`).test(text)) {
      c.errors.push(`top-level module "${mod}" is not listed in ${CODEMAP}`);
    }
  }
});

// ---------- size limits ----------

function mdFiles(dir) {
  if (!exists(dir)) return [];
  return readdirSync(abs(dir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `${dir}/${f}`);
}

check('sizes', (c) => {
  let seen = 0;
  if (exists('AGENTS.md')) {
    seen++;
    const n = lineCount(read('AGENTS.md'));
    if (n > LIMITS.agentsMd) c.errors.push(`AGENTS.md has ${n} lines (limit ${LIMITS.agentsMd})`);
  }
  for (const f of ['src/AGENTS.md', 'src-tauri/AGENTS.md']) {
    if (!exists(f)) continue;
    seen++;
    const n = lineCount(read(f));
    if (n > LIMITS.agentsMd) c.warnings.push(`${f} has ${n} lines (keep <= ${LIMITS.agentsMd})`);
  }
  for (const f of mdFiles('.cursor/agents')) {
    seen++;
    const n = lineCount(read(f));
    if (n > LIMITS.rolePrompt) c.errors.push(`${f} has ${n} lines (limit ${LIMITS.rolePrompt})`);
  }
  const lessons = 'docs/harness/lessons.md';
  if (exists(lessons)) {
    seen++;
    const n = read(lessons)
      .split(/\r?\n/)
      .filter((l) => /^\s*(?:[-*]\s+)?\[[^\]]+\]\s+\S/.test(l)).length;
    if (n > LIMITS.lessons) c.errors.push(`${lessons} has ${n} entries (limit ${LIMITS.lessons}); run /retro to compact`);
    c.notes.push(`lessons: ${n} entries`);
  }
  if (seen === 0) return 'skip';
});

// ---------- staleness ----------

function walkMd(dir, out = []) {
  if (!exists(dir)) return out;
  for (const e of readdirSync(abs(dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walkMd(rel, out);
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

function codeChangedSince(date) {
  try {
    const out = execFileSync('git', ['log', `--since=${date}`, '--oneline', '--', 'src', 'src-tauri', 'scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return true; // no git history: fall back to age alone
  }
}

check('staleness', (c) => {
  const files = ['README.md', ...walkMd('docs')].filter(
    (f) =>
      exists(f) &&
      !f.startsWith('docs/decisions/') &&
      !f.startsWith('docs/harness/templates/') &&
      f !== 'docs/harness/lessons.md' &&
      f !== 'README.md',
  );
  if (files.length === 0) return 'skip';
  const today = Date.now();
  for (const f of files) {
    const m = read(f).match(/last-verified:\s*(\d{4}-\d{2}-\d{2})/);
    if (!m) {
      c.warnings.push(`${f}: no \`last-verified: YYYY-MM-DD\` line`);
      continue;
    }
    const age = Math.floor((today - Date.parse(m[1])) / 86_400_000);
    if (age > STALE_DAYS && codeChangedSince(m[1])) {
      c.warnings.push(`${f}: last verified ${age} days ago and code changed since (${m[1]})`);
    }
  }
});

// ---------- report ----------

const json = process.argv.includes('--json');
const unknown = process.argv.slice(2).filter((a) => a !== '--json');
if (unknown.length) {
  console.error(`docs-check: unknown argument "${unknown[0]}"\nusage: docs-check.mjs [--json]`);
  process.exit(2);
}

const errors = checks.flatMap((c) => c.errors.map((m) => `[${c.name}] ${m}`));
const warnings = checks.flatMap((c) => c.warnings.map((m) => `[${c.name}] ${m}`));
const ok = errors.length === 0;

if (json) {
  console.log(
    JSON.stringify(
      { ok, errors, warnings, checks: checks.map(({ name, status, errors: e, warnings: w, notes }) => ({ name, status, errors: e, warnings: w, notes })) },
      null,
      2,
    ),
  );
} else {
  for (const c of checks) {
    const tag = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP' }[c.status];
    console.log(`[${tag}] docs-check:${c.name}${c.notes.length ? ` (${c.notes.join('; ')})` : ''}`);
    for (const m of c.errors) console.log(`  error: ${m}`);
    for (const m of c.warnings) console.log(`  warn:  ${m}`);
  }
  console.log(ok ? `docs-check OK (${warnings.length} warning(s))` : `docs-check FAILED (${errors.length} error(s), ${warnings.length} warning(s))`);
}
process.exitCode = ok ? 0 : 1;
