#!/usr/bin/env node
// Summarizes .harness/metrics/*.jsonl and .harness/runs/*.json for /retro.
// CLI contract: docs/harness/README.md section 5.
//
//   metrics-report.mjs [--wave <wave>] [--json]
//
// Reports: calls per lane, run outcomes, escalations, debugger hit rate, rework per role,
// subagent time, and parallelism (max/avg concurrency, busy vs idle wall time) overall and per wave.
// Metrics lines written by run-state.mjs have `type` init|transition|call|escalate. Lines written by the
// subagentStop hook are read leniently: `role`, `model`, `status`, `duration_ms|durationMs|duration`,
// and `ts|timestamp`.
// Exit codes: 0 ok, 2 usage error. Missing data is not an error (reports zeros).
// Override the state directory with FIORE_HARNESS_DIR (smoke tests).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = process.env.FIORE_HARNESS_DIR
  ? resolve(process.env.FIORE_HARNESS_DIR)
  : join(ROOT, '.harness');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--wave') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) usageError('--wave requires a value');
      flags.wave = v;
    } else if (a.startsWith('--wave=')) flags.wave = a.slice(7);
    else usageError(`unexpected argument "${a}"`);
  }
  return flags;
}
function usageError(m) {
  console.error(`metrics-report: ${m}\nusage: metrics-report.mjs [--wave <wave>] [--json]`);
  process.exit(2);
}

function readDir(dir, ext) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f)) : [];
}

function loadRuns() {
  const runs = new Map();
  for (const f of readDir(join(HARNESS, 'runs'), '.json')) {
    try {
      const r = JSON.parse(readFileSync(f, 'utf8'));
      if (r?.runId) runs.set(r.runId, r);
    } catch {
      /* skip corrupt */
    }
  }
  return runs;
}

function loadEvents() {
  const events = [];
  for (const f of readDir(join(HARNESS, 'metrics'), '.jsonl')) {
    const runId = basename(f, '.jsonl');
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        const ts = Date.parse(e.ts ?? e.timestamp ?? '');
        events.push({
          ...e,
          runId: e.run ?? e.runId ?? e.run_id ?? runId,
          tsMs: Number.isNaN(ts) ? null : ts,
          durMs: Number(e.duration_ms ?? e.durationMs ?? e.duration ?? NaN),
        });
      } catch {
        /* skip malformed line */
      }
    }
  }
  return events;
}

// Union length and max/avg concurrency of [start,end] intervals.
function concurrency(intervals) {
  if (intervals.length === 0) return { max: 0, avg: 0, busyUnionMs: 0, sumMs: 0, spanMs: 0, idleMs: 0 };
  const pts = [];
  let sumMs = 0;
  for (const [s, e] of intervals) {
    pts.push([s, 1], [e, -1]);
    sumMs += e - s;
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  let busyUnionMs = 0;
  let last = pts[0][0];
  for (const [t, d] of pts) {
    if (cur > 0) busyUnionMs += t - last;
    cur += d;
    max = Math.max(max, cur);
    last = t;
  }
  const spanMs = pts[pts.length - 1][0] - pts[0][0];
  return {
    max,
    avg: busyUnionMs > 0 ? +(sumMs / busyUnionMs).toFixed(2) : 0,
    busyUnionMs,
    sumMs,
    spanMs,
    idleMs: Math.max(0, spanMs - busyUnionMs),
  };
}

function intervalsOf(events) {
  return events
    .filter((e) => e.tsMs !== null && Number.isFinite(e.durMs) && e.durMs > 0)
    .map((e) => [e.tsMs - e.durMs, e.tsMs]);
}

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] ?? 0) + n;
}

function build(flags) {
  const allRuns = loadRuns();
  const allEvents = loadEvents();
  const runs = [...allRuns.values()].filter((r) => !flags.wave || r.wave === flags.wave);
  const runIds = new Set(runs.map((r) => r.runId));
  const events = allEvents.filter((e) => (flags.wave ? runIds.has(e.runId) || e.wave === flags.wave : true));

  const lanes = {};
  const states = {};
  const roles = {};
  const escalations = [];
  let debugRuns = 0;
  let debugResolved = 0;
  for (const r of runs) {
    const l = (lanes[r.lane] ??= { runs: 0, calls: 0, budget: 0, maxCalls: 0, atBudget: 0 });
    l.runs += 1;
    l.calls += r.calls;
    l.budget += r.budget;
    l.maxCalls = Math.max(l.maxCalls, r.calls);
    if (r.calls >= r.budget) l.atBudget += 1;
    bump(states, r.state);
    for (const [role, n] of Object.entries(r.callsByRole ?? {})) {
      const x = (roles[role] ??= { calls: 0, rework: 0 });
      x.calls += n;
      x.rework += Math.max(0, n - 1);
    }
    if (r.state === 'escalate') escalations.push({ run: r.runId, task: r.taskId, wave: r.wave, reason: r.escalation?.reason ?? null });
    if ((r.debugEntries ?? 0) > 0) {
      debugRuns += 1;
      if (r.state === 'done') debugResolved += 1;
    }
  }
  for (const l of Object.values(lanes)) l.avgCalls = +(l.calls / l.runs).toFixed(2);

  const stops = events.filter((e) => Number.isFinite(e.durMs) && (e.role || e.status));
  const stopStatus = {};
  const stopRoles = {};
  for (const e of stops) {
    if (e.status) bump(stopStatus, String(e.status));
    if (e.role) {
      const x = (stopRoles[e.role] ??= { n: 0, totalMs: 0 });
      x.n += 1;
      x.totalMs += e.durMs;
    }
  }

  const waves = {};
  for (const w of new Set(runs.map((r) => r.wave).filter(Boolean))) {
    const wr = runs.filter((r) => r.wave === w);
    const ids = new Set(wr.map((r) => r.runId));
    waves[w] = {
      runs: wr.length,
      calls: wr.reduce((s, r) => s + r.calls, 0),
      escalations: wr.filter((r) => r.state === 'escalate').length,
      parallelism: concurrency(intervalsOf(events.filter((e) => ids.has(e.runId)))),
    };
  }

  return {
    filter: { wave: flags.wave ?? null },
    runs: runs.length,
    metricEvents: events.length,
    lanes,
    states,
    escalations: { count: escalations.length, rate: runs.length ? +(escalations.length / runs.length).toFixed(2) : 0, items: escalations },
    debugger: { runsWithDebug: debugRuns, resolved: debugResolved, hitRate: debugRuns ? +(debugResolved / debugRuns).toFixed(2) : null },
    roles,
    subagents: { stops: stops.length, byStatus: stopStatus, byRole: stopRoles },
    parallelism: concurrency(intervalsOf(events)),
    waves,
  };
}

const dur = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

function render(r) {
  const out = [`metrics report${r.filter.wave ? ` (wave ${r.filter.wave})` : ''}: ${r.runs} run(s), ${r.metricEvents} metric event(s)`];
  if (r.runs === 0) out.push('  no runs found (.harness/runs is empty)');
  out.push('calls per lane:');
  for (const [lane, l] of Object.entries(r.lanes)) {
    out.push(`  ${lane.padEnd(3)} runs ${l.runs}  avg calls ${l.avgCalls}  max ${l.maxCalls}  at-budget ${l.atBudget}  (budget/run ${l.budget / l.runs})`);
  }
  out.push(`outcomes: ${Object.entries(r.states).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`);
  out.push(`escalations: ${r.escalations.count} (${(r.escalations.rate * 100).toFixed(0)}% of runs)`);
  for (const e of r.escalations.items) out.push(`  ${e.run}: ${e.reason ?? 'no reason'}`);
  out.push(
    `debugger hit rate: ${r.debugger.hitRate === null ? 'n/a (no debug runs)' : `${r.debugger.resolved}/${r.debugger.runsWithDebug} debug runs reached done (${(r.debugger.hitRate * 100).toFixed(0)}%)`}`,
  );
  out.push('roles (calls / rework = calls beyond the first per run):');
  for (const [role, x] of Object.entries(r.roles).sort((a, b) => b[1].rework - a[1].rework)) {
    out.push(`  ${role.padEnd(9)} calls ${x.calls}  rework ${x.rework}`);
  }
  const p = r.parallelism;
  out.push(
    p.sumMs
      ? `parallelism: max ${p.max} concurrent, avg ${p.avg} while busy; busy ${dur(p.busyUnionMs)} of ${dur(p.spanMs)} span, idle (serial gaps) ${dur(p.idleMs)}`
      : 'parallelism: no subagentStop duration data yet',
  );
  for (const [w, x] of Object.entries(r.waves)) {
    out.push(`  wave ${w}: ${x.runs} run(s), ${x.calls} calls, ${x.escalations} escalation(s), max ${x.parallelism.max} concurrent`);
  }
  return out.join('\n');
}

const flags = parseArgs(process.argv.slice(2));
const report = build(flags);
console.log(flags.json ? JSON.stringify(report, null, 2) : render(report));
