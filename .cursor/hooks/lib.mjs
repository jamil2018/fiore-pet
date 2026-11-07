// Shared helpers for Fiore hook scripts. Node >= 20, ESM, no dependencies.
// Hook contract: JSON on stdin, JSON on stdout. Verified against https://cursor.com/docs/hooks (2026-11-07).
// Every hook script wraps its work in try/catch and fails open; a bug here must never wedge the agent.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROLES = ['planner', 'executor', 'debugger', 'judge', 'explorer'];

export async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeout ?? 15000,
    input: opts.input,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

export function git(args, cwd) {
  return run('git', args, { cwd });
}

function normalizeRoot(p) {
  // Windows roots can arrive as "/g:/projects/x".
  if (/^\/[a-zA-Z]:[\\/]/.test(p)) return p.slice(1);
  return p;
}

export function projectDir(input) {
  const p = process.env.CURSOR_PROJECT_DIR || input?.workspace_roots?.[0] || process.cwd();
  return path.resolve(normalizeRoot(p));
}

/** Main checkout root. Harness state (.harness/*, logs/) lives here even when a hook fires in a worktree. */
export function mainRoot(dir) {
  const r = git(['rev-parse', '--git-common-dir'], dir);
  if (r.status !== 0) return dir;
  const common = path.resolve(dir, r.stdout.trim());
  return path.basename(common) === '.git' ? path.dirname(common) : dir;
}

/** Candidate roots for reading harness state: main checkout first, then the hook's own project dir. */
export function stateRoots(dir) {
  return [...new Set([mainRoot(dir), dir])];
}

export function currentBranch(dir) {
  const r = git(['branch', '--show-current'], dir);
  return r.status === 0 ? r.stdout.trim() : '';
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function exists(file) {
  return fs.existsSync(file);
}

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, 'utf8');
}

export function hookLog(root, hook, message) {
  try {
    const file = path.join(root, 'logs', 'hooks', 'hooks.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} [${hook}] ${message}\n`, 'utf8');
  } catch {
    // logging is best effort
  }
}

export function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Task packet parsing (subagent prompts carry the packet; see docs/harness/templates/task-packet.md)
// ---------------------------------------------------------------------------

const TOKEN = '([A-Za-z0-9][A-Za-z0-9_.-]*)';

export function parsePacket(task, subagentType) {
  const text = String(task ?? '');
  const pick = (re) => re.exec(text)?.[1];
  const runId = pick(new RegExp(`run[\\s_-]*id[^A-Za-z0-9\\n]{0,8}${TOKEN}`, 'i'));
  const taskId = pick(new RegExp(`task[\\s_-]*id[^A-Za-z0-9\\n]{0,8}${TOKEN}`, 'i'));
  let wave = pick(/\bwave[^A-Za-z0-9\n]{0,8}(w\d{2}(?:-[a-z0-9]+)?)\b/i);
  if (!wave && taskId) wave = /^(w\d{2})-/.exec(taskId)?.[1];
  let role = pick(/role[^\n:]*:\s*[`*\s]*(planner|executor|debugger|judge|explorer)\b/i)?.toLowerCase();
  if (!role && ROLES.includes(String(subagentType ?? '').toLowerCase())) role = String(subagentType).toLowerCase();
  return { runId, taskId, wave, role };
}

const TERMINAL_STATES = new Set(['done', 'escalate']);

export function runFile(roots, runId) {
  for (const root of roots) {
    const f = path.join(root, '.harness', 'runs', `${runId}.json`);
    if (exists(f)) return f;
  }
  return null;
}

/** Runs that are neither done nor escalated. Used only as a fallback when a prompt names no run. */
export function activeRuns(roots) {
  const out = [];
  for (const root of roots) {
    const dir = path.join(root, '.harness', 'runs');
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.json') || n.startsWith('.')) continue;
      const data = readJson(path.join(dir, n));
      if (!data) continue;
      const state = String(data.state ?? '').toLowerCase();
      if (!TERMINAL_STATES.has(state)) out.push(n.replace(/\.json$/, ''));
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Glob helpers for path-claim overlap
// ---------------------------------------------------------------------------

export function staticPrefix(glob) {
  const g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  const i = g.search(/[*?[{]/);
  return i === -1 ? g : g.slice(0, i);
}

/** Conservative overlap: two globs overlap when one static prefix is a prefix of the other. */
export function globsOverlap(a, b) {
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// ---------------------------------------------------------------------------
// Git change classification (stop gate)
// ---------------------------------------------------------------------------

/** Paths with uncommitted changes (tracked, staged and untracked), repo-relative with forward slashes. */
export function dirtyFiles(dir) {
  const r = git(['status', '--porcelain=v1', '-z', '-uall'], dir);
  if (r.status !== 0) return [];
  const parts = r.stdout.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const code = entry.slice(0, 2);
    files.push(entry.slice(3));
    if (code[0] === 'R' || code[0] === 'C') i++; // next entry is the rename source
  }
  return [...new Set(files.map((f) => f.replace(/\\/g, '/')))];
}

const base = (f) => f.split('/').pop();

export function isCodeFile(f) {
  if (base(f) === '.gitkeep' || /\.md$/i.test(f)) return false;
  return (
    /^src\//.test(f) ||
    /^src-tauri\//.test(f) ||
    /^public\//.test(f) ||
    /^scripts\/dev\//.test(f) ||
    /^(package(-lock)?\.json|Cargo\.(toml|lock)|vite\.config\.\w+|tsconfig[\w.]*\.json|biome\.json|rustfmt\.toml|index\.html)$/.test(f)
  );
}

export function isHarnessFile(f) {
  if (base(f) === '.gitkeep') return false;
  if (f === 'docs/harness/lessons.md') return false;
  return (
    /^\.cursor\/(agents|rules|skills|hooks)\//.test(f) ||
    f === '.cursor/hooks.json' ||
    /^docs\/harness\//.test(f)
  );
}

/** Fingerprint of the dirty code files (path + content hash). `record-verdict.mjs` may reuse the algorithm. */
export function fingerprint(dir, files) {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort()) {
    let content = 'deleted';
    try {
      content = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    } catch {
      // deleted file
    }
    h.update(`${f}\0${content}\n`);
  }
  return h.digest('hex');
}
