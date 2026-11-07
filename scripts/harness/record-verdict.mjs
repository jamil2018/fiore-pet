#!/usr/bin/env node
// Records the last judge verdict with a fingerprint of the diff since the last checkpoint
// (HEAD = last checkpoint commit; working tree + untracked files are compared against it).
// CLI contract: docs/harness/README.md section 5.
//
//   record-verdict.mjs --verdict PASS|FAIL --score <n> [--run <run-id>] [--report <path>] [--json]
//   record-verdict.mjs --check [--json]          (extra: exit 0 only if a PASS verdict matches the
//                                                 current diff fingerprint; for the stop hook)
//   record-verdict.mjs --print-fingerprint       (extra: print the current fingerprint)
//
// Exit codes: 0 ok, 1 check failed (stale/FAIL/no verdict), 2 usage error.
// Override the state directory with FIORE_HARNESS_DIR (smoke tests).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = process.env.FIORE_HARNESS_DIR
  ? resolve(process.env.FIORE_HARNESS_DIR)
  : join(ROOT, '.harness');
const VERDICT_FILE = join(HARNESS, 'verdict.json');
const MAX_SCORE = 14;
const PASS_MIN = 11;

// Local/generated state that must not change the fingerprint.
const EXCLUDED = [
  /^\.harness\//,
  /^logs\//,
  /^target\//,
  /^node_modules\//,
  /^dist\//,
  /^evals\/results\//,
  /^docs\/harness\/lessons\.md$/,
];

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const flags = {};
  const booleans = ['json', 'check', 'print-fingerprint'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new CliError(2, `unexpected argument "${a}"`);
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (booleans.includes(name)) flags[name] = true;
    else if (eq !== -1) flags[name] = a.slice(eq + 1);
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new CliError(2, `--${name} requires a value`);
      flags[name] = v;
    }
  }
  return flags;
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (allowFail) return null;
    throw new CliError(1, `git ${args.join(' ')} failed: ${e.stderr?.toString().trim() || e.message}`);
  }
}

const lines = (s) => (s ?? '').split('\0').filter(Boolean);

function computeFingerprint() {
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true })?.trim() !== 'true') {
    return { fingerprint: 'no-git', base: null, files: [] };
  }
  const head = git(['rev-parse', '--verify', 'HEAD'], { allowFail: true })?.trim() || null;
  const changed = new Set();
  if (head) {
    for (const f of lines(git(['diff', '--name-only', '-z', 'HEAD']))) changed.add(f);
  } else {
    for (const f of lines(git(['ls-files', '-z', '--cached']))) changed.add(f);
  }
  for (const f of lines(git(['ls-files', '-z', '--others', '--exclude-standard']))) changed.add(f);

  const files = [...changed].filter((f) => !EXCLUDED.some((re) => re.test(f))).sort();
  const hash = createHash('sha256');
  hash.update(`base:${head ?? 'none'}\n`);
  for (const f of files) {
    const abs = join(ROOT, f);
    let content = 'deleted';
    try {
      if (existsSync(abs) && statSync(abs).isFile()) {
        content = createHash('sha256').update(readFileSync(abs)).digest('hex');
      }
    } catch {
      content = 'unreadable';
    }
    hash.update(`${f}\0${content}\n`);
  }
  return { fingerprint: hash.digest('hex'), base: head, files };
}

function loadVerdict() {
  if (!existsSync(VERDICT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(VERDICT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags['print-fingerprint']) {
    const fp = computeFingerprint();
    console.log(flags.json ? JSON.stringify(fp, null, 2) : fp.fingerprint);
    return 0;
  }

  if (flags.check) {
    const v = loadVerdict();
    const fp = computeFingerprint();
    const result = {
      hasVerdict: Boolean(v),
      verdict: v?.verdict ?? null,
      score: v?.score ?? null,
      match: Boolean(v && v.fingerprint === fp.fingerprint),
      fingerprint: fp.fingerprint,
    };
    result.ok = result.match && result.verdict === 'PASS';
    const reason = !v
      ? 'no verdict recorded'
      : !result.match
        ? 'diff changed since the last verdict (judge required)'
        : v.verdict !== 'PASS'
          ? `last verdict is ${v.verdict}`
          : 'last PASS verdict matches the current diff';
    console.log(flags.json ? JSON.stringify({ ...result, reason }, null, 2) : `${result.ok ? 'OK' : 'STALE'}: ${reason}`);
    return result.ok ? 0 : 1;
  }

  const verdict = String(flags.verdict ?? '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(verdict)) throw new CliError(2, '--verdict PASS|FAIL is required');
  if (flags.score === undefined) throw new CliError(2, '--score <n> is required');
  const score = Number(flags.score);
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw new CliError(2, `--score must be an integer 0..${MAX_SCORE}`);
  }
  if (verdict === 'PASS' && score < PASS_MIN) {
    throw new CliError(2, `PASS requires score >= ${PASS_MIN}/${MAX_SCORE} (docs/harness/judge-rubric.md); got ${score}`);
  }
  if (flags.report && !existsSync(resolve(ROOT, flags.report))) {
    console.error(`record-verdict: warning: report "${flags.report}" not found`);
  }

  const fp = computeFingerprint();
  const record = {
    verdict,
    score,
    maxScore: MAX_SCORE,
    run: flags.run ?? null,
    report: flags.report ?? null,
    fingerprint: fp.fingerprint,
    base: fp.base,
    fileCount: fp.files.length,
    files: fp.files,
    recordedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(VERDICT_FILE), { recursive: true });
  const tmp = `${VERDICT_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, VERDICT_FILE);
  console.log(
    flags.json
      ? JSON.stringify(record, null, 2)
      : `verdict ${verdict} ${score}/${MAX_SCORE} recorded (fingerprint ${fp.fingerprint.slice(0, 12)}, ${fp.files.length} file(s) since ${fp.base?.slice(0, 7) ?? 'start'})`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof CliError) {
    console.error(`record-verdict: ${e.message}`);
    process.exitCode = e.code;
  } else {
    console.error(`record-verdict: internal error: ${e.stack ?? e}`);
    process.exitCode = 1;
  }
}
