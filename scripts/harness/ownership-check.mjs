#!/usr/bin/env node
// Compares a task branch's diff with the task's claimed `owns:` globs. Run at integration.
// CLI contract: docs/harness/README.md section 5.
//
//   ownership-check.mjs --branch <task/...> --task <task-id> [--base main] [--json]
//
// Reads the claim from .harness/claims/<task-id>.json, falling back to the archive written by
// `run-state.mjs release` (.harness/claims/released/<task-id>.json).
// Findings:
//   shared        edit to a shared/contract file the task does not own (goes back to the contract owner)
//   out-of-claim  edit outside the claimed owns globs (small deviations may be accepted and logged)
// Exit codes: 0 clean, 1 violations found, 2 usage error / missing claim or branch.
// Override the state directory with FIORE_HARNESS_DIR (smoke tests).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = process.env.FIORE_HARNESS_DIR
  ? resolve(process.env.FIORE_HARNESS_DIR)
  : join(ROOT, '.harness');

// Contract files that only integration (or the contract task) may edit.
const SHARED = [
  'docs/codemap.md',
  'docs/fiore-mvp-spec.md',
  'src-tauri/src/events.rs',
  'src/events.ts',
  'src-tauri/src/sensors/mod.rs',
  'src/behavior/reactions/index.ts',
  'src-tauri/src/hub.rs',
  'src/behavior/types.ts',
];

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new CliError(2, `unexpected argument "${a}"`);
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (name === 'json') flags.json = true;
    else if (eq !== -1) flags[name] = a.slice(eq + 1);
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new CliError(2, `--${name} requires a value`);
      flags[name] = v;
    }
  }
  return flags;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new CliError(2, `git ${args.join(' ')} failed: ${e.stderr?.toString().trim() || e.message}`);
  }
}

// `**/` = any directories (incl. none), `**` = anything, `*` = within a segment.
// A pattern without wildcards matches the path itself and everything under it.
function globToRegExp(glob) {
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  const wild = /[*?]/.test(g);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}${wild ? '' : '(?:/.*)?'}$`);
}

const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));

function loadClaim(taskId) {
  for (const f of [join(HARNESS, 'claims', `${taskId}.json`), join(HARNESS, 'claims', 'released', `${taskId}.json`)]) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  }
  return null;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.branch || !flags.task) {
    throw new CliError(2, 'usage: ownership-check.mjs --branch <task/...> --task <task-id> [--base main] [--json]');
  }
  const base = flags.base ?? 'main';
  const claim = loadClaim(flags.task);
  if (!claim) throw new CliError(2, `no claim found for task "${flags.task}" (run-state.mjs claim ...)`);
  for (const ref of [flags.branch, base]) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      throw new CliError(2, `git ref "${ref}" not found`);
    }
  }

  const diff = git(['diff', '--name-status', '-z', '--no-renames', `${base}...${flags.branch}`]).split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i + 1 < diff.length; i += 2) changed.push({ status: diff[i], file: diff[i + 1] });

  const owns = claim.owns ?? [];
  const inClaim = [];
  const shared = [];
  const outOfClaim = [];
  for (const { status, file } of changed) {
    if (matchesAny(file, owns)) inClaim.push(file);
    else if (SHARED.includes(file)) shared.push({ file, status });
    else outOfClaim.push({ file, status });
  }
  const ok = shared.length === 0 && outOfClaim.length === 0;
  const result = {
    ok,
    task: flags.task,
    branch: flags.branch,
    base,
    owns,
    changed: changed.length,
    inClaim,
    shared,
    outOfClaim,
  };

  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ownership-check ${flags.task} (${flags.branch} vs ${base}): ${changed.length} changed file(s), owns ${owns.join(', ')}`);
    for (const s of shared) console.log(`  SHARED        ${s.status} ${s.file}  (contract file: report as deviation, integration applies it)`);
    for (const o of outOfClaim) console.log(`  OUT-OF-CLAIM  ${o.status} ${o.file}`);
    console.log(ok ? `OK: all ${inClaim.length} edit(s) inside the claim` : `VIOLATIONS: ${shared.length} shared, ${outOfClaim.length} out-of-claim`);
  }
  return ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof CliError) {
    console.error(`ownership-check: ${e.message}`);
    process.exitCode = e.code;
  } else {
    console.error(`ownership-check: internal error: ${e.stack ?? e}`);
    process.exitCode = 1;
  }
}
