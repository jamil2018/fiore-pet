#!/usr/bin/env node
// Run state machine, lane budgets, wave budgets and path claims.
// CLI contract: docs/harness/README.md section 5. Exit codes: 0 ok, 1 rule failure,
// 2 usage error, 3 budget exceeded / escalate.
//
// State lives in .harness/runs/<run-id>.json (audit trail). One metrics file per run in
// .harness/metrics/<run-id>.jsonl. Claims in .harness/claims/<task-id>.json (released claims are
// archived in .harness/claims/released/ so ownership-check can still read them at integration).
// Override the state directory with FIORE_HARNESS_DIR (used for smoke tests).

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = process.env.FIORE_HARNESS_DIR
  ? resolve(process.env.FIORE_HARNESS_DIR)
  : join(ROOT, '.harness');
const RUNS = join(HARNESS, 'runs');
const METRICS = join(HARNESS, 'metrics');
const CLAIMS = join(HARNESS, 'claims');
const RELEASED = join(CLAIMS, 'released');
const LOCKS = join(RUNS, '.locks');

const LANES = { XS: 3, S: 5, M: 10, L: 25 };
const WAVE_OVERHEAD = 4; // planner, judge, integration
const ROLES = ['planner', 'executor', 'debugger', 'judge', 'explorer'];
const ROLE_CAPS = { judge: 1, debugger: 3 };
const MAX_DEBUG_ENTRIES = 3;
const STATES = ['intake', 'plan', 'execute', 'check', 'debug', 'judge', 'done', 'escalate'];
const TRANSITIONS = {
  intake: ['plan', 'execute', 'escalate'],
  plan: ['execute', 'escalate'],
  execute: ['check', 'escalate'],
  check: ['debug', 'judge', 'done', 'escalate'],
  debug: ['check', 'escalate'],
  judge: ['debug', 'done', 'escalate'],
  done: [],
  escalate: [],
};

const EXIT = { OK: 0, FAIL: 1, USAGE: 2, BUDGET: 3 };

// ---------- helpers ----------

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const usage = (m) => new CliError(EXIT.USAGE, m);
const fail = (m) => new CliError(EXIT.FAIL, m);

function parseArgs(argv, booleans = ['json']) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (booleans.includes(name)) {
      flags[name] = true;
    } else if (eq !== -1) {
      flags[name] = a.slice(eq + 1);
    } else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw usage(`--${name} requires a value`);
      flags[name] = v;
    }
  }
  return { positional, flags };
}

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const WAVE_RE = /^[a-z0-9][a-z0-9._-]*$/;
function checkId(kind, v) {
  if (!v || !ID_RE.test(v)) throw usage(`invalid ${kind} "${v ?? ''}" (lowercase kebab: ${ID_RE})`);
  return v;
}
function checkWave(v) {
  if (!v || !WAVE_RE.test(v)) throw usage(`invalid wave "${v ?? ''}" (${WAVE_RE})`);
  return v;
}

const splitList = (s) =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);

const now = () => new Date().toISOString();

function ensureDir(d) {
  mkdirSync(d, { recursive: true });
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Directory-based lock: parallel hooks may call `call`/`claim` at the same time.
function withLock(name, fn) {
  ensureDir(LOCKS);
  const dir = join(LOCKS, `${name}.lock`);
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(dir).mtimeMs > 15_000) rmSync(dir, { recursive: true, force: true });
      } catch {
        /* lock vanished */
      }
      if (Date.now() > deadline) throw fail(`could not acquire lock "${name}"`);
      sleepMs(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function writeJson(file, obj) {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, file);
}

const runFile = (id) => join(RUNS, `${id}.json`);

function loadRun(id) {
  checkId('run id', id);
  const f = runFile(id);
  if (!existsSync(f)) throw usage(`unknown run "${id}" (run: init ${id} --lane ...)`);
  return readJson(f);
}
function saveRun(run) {
  run.updatedAt = now();
  writeJson(runFile(run.runId), run);
}
function metric(run, ev) {
  ensureDir(METRICS);
  const rec = { ts: now(), run: run.runId, task: run.taskId, wave: run.wave, lane: run.lane, ...ev };
  appendFileSync(join(METRICS, `${run.runId}.jsonl`), `${JSON.stringify(rec)}\n`);
}

function listRuns() {
  if (!existsSync(RUNS)) return [];
  const out = [];
  for (const f of readdirSync(RUNS)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(readJson(join(RUNS, f)));
    } catch {
      /* ignore partial/corrupt file */
    }
  }
  return out;
}

function print(json, obj, text) {
  console.log(json ? JSON.stringify(obj, null, 2) : text);
}

function escalate(run, reason) {
  const from = run.state;
  run.state = 'escalate';
  run.escalation = { reason, from, ts: now() };
  run.history.push({ ts: now(), from, to: 'escalate', reason });
  saveRun(run);
  metric(run, { type: 'escalate', from, reason });
}

function remaining(run) {
  return Math.max(0, run.budget - run.calls);
}

function summarize(run) {
  return {
    runId: run.runId,
    taskId: run.taskId,
    wave: run.wave,
    lane: run.lane,
    waveLevel: run.waveLevel,
    state: run.state,
    budget: run.budget,
    calls: run.calls,
    remaining: remaining(run),
    callsByRole: run.callsByRole,
    debugEntries: run.debugEntries,
    checkEntries: run.checkEntries,
    allowedNext: TRANSITIONS[run.state],
    escalation: run.escalation,
  };
}

// ---------- glob overlap (claims) ----------

function expandPattern(p) {
  let s = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (s.endsWith('/')) s += '**';
  return /[*?]/.test(s) ? [s] : [s, `${s}/**`]; // plain path = file or directory
}

function segRe(seg) {
  const re = seg
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`);
}

function segCompat(a, b) {
  if (a === b) return true;
  const wa = /[*?]/.test(a);
  const wb = /[*?]/.test(b);
  if (!wa && !wb) return false;
  if (wa && !wb) return segRe(a).test(b);
  if (wb && !wa) return segRe(b).test(a);
  const pa = a.split(/[*?]/)[0];
  const pb = b.split(/[*?]/)[0];
  const sa = a.split(/[*?]/).pop();
  const sb = b.split(/[*?]/).pop();
  return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
}

// Can some path match both segment lists? `**` matches zero or more segments.
function overlapSegs(A, i, B, j) {
  if (i === A.length && j === B.length) return true;
  if (i < A.length && A[i] === '**') {
    if (overlapSegs(A, i + 1, B, j)) return true;
    if (j < B.length && overlapSegs(A, i, B, j + 1)) return true;
    return false;
  }
  if (j < B.length && B[j] === '**') {
    if (overlapSegs(A, i, B, j + 1)) return true;
    if (i < A.length && overlapSegs(A, i + 1, B, j)) return true;
    return false;
  }
  if (i === A.length || j === B.length) return false;
  return segCompat(A[i], B[j]) && overlapSegs(A, i + 1, B, j + 1);
}

function globsOverlap(listA, listB) {
  for (const a of listA.flatMap(expandPattern)) {
    for (const b of listB.flatMap(expandPattern)) {
      if (overlapSegs(a.split('/'), 0, b.split('/'), 0)) return [a, b];
    }
  }
  return null;
}

// ---------- commands ----------

function cmdInit(args) {
  const { positional, flags } = parseArgs(args);
  const runId = checkId('run id', positional[0]);
  const lane = String(flags.lane ?? '').toUpperCase();
  if (!LANES[lane]) throw usage(`--lane must be one of ${Object.keys(LANES).join('|')}`);
  const taskId = flags.task ? checkId('task id', flags.task) : null;
  const wave = flags.wave ? checkWave(flags.wave) : null;
  // A run in a wave without a task is a wave-level run (planner/judge/integration): it draws
  // from the +4 wave overhead instead of a lane budget.
  const waveLevel = Boolean(wave && !taskId);
  return withLock(`run-${runId}`, () => {
    if (existsSync(runFile(runId))) throw fail(`run "${runId}" already exists`);
    const run = {
      runId,
      taskId,
      wave,
      lane,
      waveLevel,
      state: 'intake',
      budget: waveLevel ? WAVE_OVERHEAD : LANES[lane],
      calls: 0,
      callsByRole: {},
      debugEntries: 0,
      checkEntries: 0,
      history: [{ ts: now(), from: null, to: 'intake' }],
      callLog: [],
      escalation: null,
      createdAt: now(),
      updatedAt: now(),
    };
    saveRun(run);
    metric(run, { type: 'init', budget: run.budget });
    print(
      flags.json,
      summarize(run),
      `init ${runId}: lane ${lane}, budget ${run.budget} calls${waveLevel ? ' (wave-level run)' : ''}, state intake`,
    );
    return EXIT.OK;
  });
}

function cmdTransition(args) {
  const { positional, flags } = parseArgs(args);
  const runId = positional[0];
  const to = positional[1];
  if (!to) throw usage('usage: transition <run-id> <state>');
  if (!STATES.includes(to)) throw usage(`unknown state "${to}" (${STATES.join('|')})`);
  return withLock(`run-${runId}`, () => {
    const run = loadRun(runId);
    const from = run.state;
    if (!TRANSITIONS[from].includes(to)) {
      throw fail(
        `illegal transition ${from} -> ${to}; allowed from ${from}: ${TRANSITIONS[from].join(', ') || '(none, run is terminal)'}`,
      );
    }
    if (to === 'escalate') {
      escalate(run, flags.reason ?? 'requested');
      print(flags.json, summarize(run), `run ${runId}: ${from} -> escalate. Stop and report to the user.`);
      return EXIT.BUDGET;
    }
    if (to === 'debug' && run.debugEntries >= MAX_DEBUG_ENTRIES) {
      escalate(run, `debug attempts exhausted (${MAX_DEBUG_ENTRIES})`);
      print(
        flags.json,
        summarize(run),
        `run ${runId}: debug attempts exhausted (${MAX_DEBUG_ENTRIES}); escalated. Stop and report to the user.`,
      );
      return EXIT.BUDGET;
    }
    if (to === 'debug') run.debugEntries += 1;
    if (to === 'check') run.checkEntries += 1;
    run.state = to;
    run.history.push({ ts: now(), from, to });
    saveRun(run);
    metric(run, { type: 'transition', from, to });
    print(flags.json, summarize(run), `run ${runId}: ${from} -> ${to}`);
    return EXIT.OK;
  });
}

function cmdCall(args) {
  const { positional, flags } = parseArgs(args);
  const runId = positional[0];
  const role = positional[1];
  if (!role) throw usage(`usage: call <run-id> <role>  (roles: ${ROLES.join('|')})`);
  if (!ROLES.includes(role)) throw usage(`unknown role "${role}" (${ROLES.join('|')})`);
  return withLock(`run-${runId}`, () => {
    const run = loadRun(runId);
    if (run.state === 'escalate') {
      print(flags.json, { ...summarize(run), blocked: true }, `run ${runId} is escalated; stop and report to the user.`);
      return EXIT.BUDGET;
    }
    if (run.state === 'done') throw fail(`run ${runId} is done; start a new run`);
    const roleCalls = run.callsByRole[role] ?? 0;
    if (run.calls + 1 > run.budget) {
      escalate(run, `subagent-call budget ${run.budget} exceeded by ${role} call`);
      print(
        flags.json,
        { ...summarize(run), blocked: true },
        `run ${runId}: budget ${run.budget} used up; ${role} call refused, run escalated. Stop and report to the user.`,
      );
      return EXIT.BUDGET;
    }
    if (ROLE_CAPS[role] !== undefined && roleCalls + 1 > ROLE_CAPS[role]) {
      escalate(run, `${role} call cap ${ROLE_CAPS[role]} exceeded`);
      print(
        flags.json,
        { ...summarize(run), blocked: true },
        `run ${runId}: ${role} cap ${ROLE_CAPS[role]} reached; run escalated. Stop and report to the user.`,
      );
      return EXIT.BUDGET;
    }
    run.calls += 1;
    run.callsByRole[role] = roleCalls + 1;
    run.callLog.push({ ts: now(), role, state: run.state });
    saveRun(run);
    metric(run, { type: 'call', role, state: run.state, calls: run.calls });
    const note = remaining(run) === 0 ? ' (budget now used up)' : '';
    print(
      flags.json,
      summarize(run),
      `run ${runId}: ${role} call ${run.calls}/${run.budget}, ${remaining(run)} remaining${note}`,
    );
    return EXIT.OK;
  });
}

function cmdStatus(args) {
  const { positional, flags } = parseArgs(args);
  if (!positional[0]) throw usage('usage: status <run-id> [--json]');
  const run = loadRun(positional[0]);
  const s = summarize(run);
  const lines = [
    `run ${run.runId}${run.taskId ? ` (task ${run.taskId})` : ''}${run.wave ? ` [wave ${run.wave}]` : ''}`,
    `lane ${run.lane}  state ${run.state}  calls ${run.calls}/${run.budget} (${s.remaining} remaining)`,
    `by role: ${Object.entries(run.callsByRole).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`,
    `debug entries ${run.debugEntries}/${MAX_DEBUG_ENTRIES}  check entries ${run.checkEntries}`,
    `next: ${s.allowedNext.join(', ') || '(terminal)'}`,
  ];
  if (run.escalation) lines.push(`ESCALATED from ${run.escalation.from}: ${run.escalation.reason}`);
  print(flags.json, s, lines.join('\n'));
  return run.state === 'escalate' ? EXIT.BUDGET : EXIT.OK;
}

function claimFiles() {
  if (!existsSync(CLAIMS)) return [];
  return readdirSync(CLAIMS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return readJson(join(CLAIMS, f));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function cmdClaim(args) {
  const { positional, flags } = parseArgs(args);
  const taskId = checkId('task id', positional[0]);
  const owns = splitList(flags.owns);
  if (owns.length === 0) throw usage('claim requires --owns <glob,...>');
  const reads = splitList(flags.reads);
  const wave = flags.wave ? checkWave(flags.wave) : null;
  return withLock('claims', () => {
    for (const other of claimFiles()) {
      if (other.taskId === taskId) continue;
      const hit = globsOverlap(owns, other.owns ?? []);
      if (hit) {
        throw fail(
          `claim refused: task "${taskId}" owns "${hit[0]}" which overlaps "${hit[1]}" owned by running task "${other.taskId}"`,
        );
      }
    }
    const claim = { taskId, wave, owns, reads, claimedAt: now() };
    writeJson(join(CLAIMS, `${taskId}.json`), claim);
    print(flags.json, claim, `claimed ${taskId}: owns ${owns.join(', ')}${reads.length ? `; reads ${reads.join(', ')}` : ''}`);
    return EXIT.OK;
  });
}

function cmdRelease(args) {
  const { positional, flags } = parseArgs(args);
  const taskId = checkId('task id', positional[0]);
  return withLock('claims', () => {
    const f = join(CLAIMS, `${taskId}.json`);
    if (!existsSync(f)) {
      print(flags.json, { taskId, released: false }, `no active claim for ${taskId}`);
      return EXIT.OK;
    }
    ensureDir(RELEASED);
    renameSync(f, join(RELEASED, `${taskId}.json`));
    print(flags.json, { taskId, released: true }, `released ${taskId}`);
    return EXIT.OK;
  });
}

function waveSummary(wave) {
  const runs = listRuns().filter((r) => r.wave === wave);
  const tasks = new Map();
  let overheadCalls = 0;
  for (const r of runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (r.waveLevel) {
      overheadCalls += r.calls;
      continue;
    }
    const key = r.taskId ?? r.runId;
    const t = tasks.get(key) ?? { taskId: key, budget: 0, calls: 0, runs: 0, state: r.state, lane: r.lane };
    t.budget = r.budget; // latest run's lane budget for the task
    t.calls += r.calls;
    t.runs += 1;
    t.state = r.state;
    t.lane = r.lane;
    tasks.set(key, t);
  }
  const taskList = [...tasks.values()];
  const budget = taskList.reduce((s, t) => s + t.budget, 0) + WAVE_OVERHEAD;
  const used = taskList.reduce((s, t) => s + t.calls, 0) + overheadCalls;
  return {
    wave,
    runs: runs.length,
    tasks: taskList,
    overheadCalls,
    budget,
    used,
    remaining: Math.max(0, budget - used),
    exceeded: used > budget,
    escalated: taskList.filter((t) => t.state === 'escalate').map((t) => t.taskId),
  };
}

function cmdWave(args) {
  const { positional, flags } = parseArgs(args);
  const wave = checkWave(positional[0]);
  const sub = positional[1] ?? 'status';
  if (!['status', 'budget'].includes(sub)) throw usage('usage: wave <wave> status|budget [--json]');
  const w = waveSummary(wave);
  let text;
  if (sub === 'budget') {
    text = `wave ${wave}: ${w.used}/${w.budget} calls used (${w.remaining} remaining; budget = sum of task budgets + ${WAVE_OVERHEAD})`;
  } else {
    const rows = w.tasks.map(
      (t) => `  ${t.taskId.padEnd(24)} ${t.lane.padEnd(2)} ${t.state.padEnd(9)} ${t.calls}/${t.budget} calls`,
    );
    text = [
      `wave ${wave}: ${w.runs} run(s), ${w.used}/${w.budget} calls used (${w.remaining} remaining)`,
      ...rows,
      `  wave-level calls (planner/judge/integration): ${w.overheadCalls}/${WAVE_OVERHEAD}`,
      w.escalated.length ? `  ESCALATED: ${w.escalated.join(', ')}` : '  no escalations',
      w.exceeded ? '  WAVE BUDGET EXCEEDED: stop and report to the user.' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  print(flags.json, w, text);
  return w.exceeded ? EXIT.BUDGET : EXIT.OK;
}

const HELP = `usage:
  run-state.mjs init <run-id> --lane XS|S|M|L [--task <task-id>] [--wave <wave>] [--json]
  run-state.mjs transition <run-id> <state> [--reason <text>] [--json]
  run-state.mjs call <run-id> <role> [--json]
  run-state.mjs status <run-id> [--json]
  run-state.mjs claim <task-id> --owns <glob,...> [--reads <glob,...>] [--wave <wave>]
  run-state.mjs release <task-id>
  run-state.mjs wave <wave> status|budget [--json]
states: ${STATES.join(' ')}
roles:  ${ROLES.join(' ')}
exit:   0 ok, 1 rule failure, 2 usage error, 3 budget exceeded / escalate`;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const commands = {
    init: cmdInit,
    transition: cmdTransition,
    call: cmdCall,
    status: cmdStatus,
    claim: cmdClaim,
    release: cmdRelease,
    wave: cmdWave,
  };
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return cmd ? EXIT.OK : EXIT.USAGE;
  }
  if (!commands[cmd]) throw usage(`unknown command "${cmd}"\n${HELP}`);
  return commands[cmd](rest);
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof CliError) {
    console.error(`run-state: ${e.message}`);
    process.exitCode = e.code;
  } else {
    console.error(`run-state: internal error: ${e.stack ?? e}`);
    process.exitCode = EXIT.FAIL;
  }
}
