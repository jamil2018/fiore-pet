// subagentStart hook: platform-level budget and path-claim guard.
//
// Reads the task packet from the subagent prompt (`Run id:`, `Task id:`, `Role ...:`, `Wave:`), then:
//   1. denies when run-state reports the run escalated or over budget (calls > budget, or exit code 3);
//   2. denies when the wave budget is exceeded (`run-state.mjs wave <wave> budget` exits 3);
//   3. for executor/debugger subagents in a wave, denies when the task has no claim in .harness/claims/
//      or its owns: globs overlap another live claim.
// It never counts calls itself (the orchestrator does that via `run-state.mjs call`), so there is no double counting.
// Prompts that carry no run id are allowed (ad hoc work, Phase 0 builds). Internal errors fail open.
import fs from 'node:fs';
import path from 'node:path';
import {
  activeRuns, appendJsonl, emit, exists, globsOverlap, hookLog, mainRoot, mtimeMs, parsePacket,
  projectDir, readInput, readJson, run, runFile, sha1, stateRoots,
} from './lib.mjs';

const STALE_CLAIM_MS = 24 * 3600 * 1000;

function hasRunState(roots) {
  return roots.some((r) => exists(path.join(r, 'scripts', 'harness', 'run-state.mjs')));
}

function runState(roots, args) {
  for (const root of roots) {
    const script = path.join(root, 'scripts', 'harness', 'run-state.mjs');
    if (exists(script)) return run(process.execPath, [script, ...args], { cwd: root, timeout: 10000 });
  }
  return null;
}

function num(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return num(v.total ?? v.used ?? v.count ?? v.calls);
  return undefined;
}

function checkRun(roots, runId) {
  const res = runState(roots, ['status', runId, '--json']);
  if (res?.status === 3) return `run ${runId} is over budget or escalated (run-state exit 3)`;
  const data = (() => {
    if (res?.status === 0) {
      try {
        return JSON.parse(res.stdout);
      } catch {
        // fall through to the file
      }
    }
    const f = runFile(roots, runId);
    return f ? readJson(f) : null;
  })();
  if (!data) return null;
  const state = String(data.state ?? data.status ?? '').toLowerCase();
  if (state === 'escalate') return `run ${runId} is in state "escalate"; stop and report to the user`;
  const calls = num(data.calls ?? data.callCount ?? data.used);
  const budget = num(data.budget ?? data.callBudget ?? data.limit);
  if (calls !== undefined && budget !== undefined && calls > budget) return `run ${runId} used ${calls} subagent calls, budget is ${budget}`;
  return null;
}

function claimsDir(roots) {
  return roots.map((r) => path.join(r, '.harness', 'claims')).find((d) => exists(d));
}

function ownsOf(claim) {
  const v = claim?.owns ?? claim?.paths ?? claim?.globs ?? [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
}

function checkClaim(roots, taskId) {
  const dir = claimsDir(roots);
  const mine = dir ? readJson(path.join(dir, `${taskId}.json`)) : null;
  if (!mine) return `task ${taskId} has no path claim; run \`node scripts/harness/run-state.mjs claim ${taskId} --owns <globs>\` first`;
  const myOwns = ownsOf(mine);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name === `${taskId}.json`) continue;
    const file = path.join(dir, name);
    if (Date.now() - mtimeMs(file) > STALE_CLAIM_MS) continue;
    const other = readJson(file);
    if (!other || other.released || other.status === 'released') continue;
    const clash = ownsOf(other).find((o) => myOwns.some((m) => globsOverlap(m, o)));
    if (clash) return `task ${taskId} claim overlaps running task ${name.replace(/\.json$/, '')} (${clash})`;
  }
  return null;
}

function metricsFile(root, runId, input) {
  const dir = path.join(root, '.harness', 'metrics');
  if (runId) return path.join(dir, `${runId}.jsonl`);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(dir, `unattributed-${day}-${String(input.parent_conversation_id ?? 'na').slice(0, 8)}.jsonl`);
}

async function main() {
  const input = await readInput();
  const dir = projectDir(input);
  const root = mainRoot(dir);
  const roots = stateRoots(dir);
  const { runId: packetRun, taskId, wave, role } = parsePacket(input.task, input.subagent_type);

  let runId = packetRun && runFile(roots, packetRun) ? packetRun : undefined;
  if (!runId) {
    const active = activeRuns(roots);
    if (active.length === 1) runId = active[0];
  }

  let reason = null;
  try {
    if (runId) reason = checkRun(roots, runId);
    if (!reason && wave) {
      const res = runState(roots, ['wave', wave, 'budget']);
      if (res?.status === 3) reason = `wave ${wave} budget exceeded`;
    }
    if (!reason && taskId && wave && (role === 'executor' || role === 'debugger') && hasRunState(roots)) {
      reason = checkClaim(roots, taskId);
    }
  } catch (err) {
    hookLog(root, 'subagent-start', `internal error, allowing: ${err?.message}`);
  }

  const now = Date.now();
  const event = {
    ts: new Date(now).toISOString(),
    event: reason ? 'subagent_denied' : 'subagent_start',
    run_id: runId ?? null,
    task_id: taskId ?? null,
    wave: wave ?? null,
    role: role ?? null,
    subagent_type: input.subagent_type ?? null,
    model: input.subagent_model ?? null,
    subagent_id: input.subagent_id ?? null,
    parallel: input.is_parallel_worker ?? null,
    git_branch: input.git_branch ?? null,
    reason,
  };
  try {
    appendJsonl(metricsFile(root, runId, input), event);
    if (!reason) {
      const pending = path.join(root, 'logs', 'hooks', 'pending', `${sha1(`${input.subagent_type}\0${input.task}`)}.json`);
      fs.mkdirSync(path.dirname(pending), { recursive: true });
      fs.writeFileSync(pending, JSON.stringify({ started: now, model: input.subagent_model, run_id: runId ?? null, task_id: taskId ?? null, wave: wave ?? null, role: role ?? null }));
    }
  } catch (err) {
    hookLog(root, 'subagent-start', `metrics write failed: ${err?.message}`);
  }

  if (reason) {
    hookLog(root, 'subagent-start', `DENY ${reason}`);
    emit({ permission: 'deny', user_message: `Fiore harness: subagent blocked: ${reason}. Stop and report to the user (escalate); do not retry.` });
  } else {
    emit({ permission: 'allow' });
  }
}

main().catch(() => emit({ permission: 'allow' }));
