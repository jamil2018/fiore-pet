// subagentStop hook: append one metrics line per finished subagent to .harness/metrics/<run-id>.jsonl.
// One file per run (no shared append target), so parallel subagents never collide.
// Run id / task id / role come from the matching subagentStart record (keyed by type + prompt hash),
// falling back to parsing the prompt. Never returns a followup_message.
import fs from 'node:fs';
import path from 'node:path';
import { activeRuns, appendJsonl, emit, hookLog, mainRoot, parsePacket, projectDir, readInput, readJson, runFile, sha1, stateRoots } from './lib.mjs';

async function main(input) {
  const dir = projectDir(input);
  const root = mainRoot(dir);
  const roots = stateRoots(dir);
  const key = sha1(`${input.subagent_type}\0${input.task}`);
  const pendingFile = path.join(root, 'logs', 'hooks', 'pending', `${key}.json`);
  const pending = readJson(pendingFile) ?? {};
  const packet = parsePacket(input.task, input.subagent_type);

  let runId = pending.run_id ?? (packet.runId && runFile(roots, packet.runId) ? packet.runId : undefined);
  if (!runId) {
    const active = activeRuns(roots);
    if (active.length === 1) runId = active[0];
  }

  const now = Date.now();
  const record = {
    ts: new Date(now).toISOString(),
    event: 'subagent_stop',
    run_id: runId ?? null,
    task_id: pending.task_id ?? packet.taskId ?? null,
    wave: pending.wave ?? packet.wave ?? null,
    role: pending.role ?? packet.role ?? null,
    subagent_type: input.subagent_type ?? null,
    model: pending.model ?? null,
    status: input.status ?? null,
    duration_ms: input.duration_ms ?? (pending.started ? now - pending.started : null),
    started_ms: pending.started ?? null,
    message_count: input.message_count ?? null,
    tool_call_count: input.tool_call_count ?? null,
    loop_count: input.loop_count ?? null,
    modified_files: Array.isArray(input.modified_files) ? input.modified_files : [],
    description: input.description ?? null,
  };

  const metrics = runId
    ? path.join(root, '.harness', 'metrics', `${runId}.jsonl`)
    : path.join(root, '.harness', 'metrics', `unattributed-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${String(input.conversation_id ?? 'na').slice(0, 8)}.jsonl`);
  appendJsonl(metrics, record);
  try {
    fs.rmSync(pendingFile, { force: true });
  } catch {
    // best effort
  }
}

readInput()
  .then(main)
  .catch(async (err) => {
    hookLog(mainRoot(projectDir({})), 'subagent-stop', `internal error: ${err?.message}`);
  })
  .finally(() => emit({}));
