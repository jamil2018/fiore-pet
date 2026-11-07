// stop hook: branch-aware completion gates, combined into one followup_message.
//
// Applies ONLY on the integration branch (`main`). task/* worktree branches are gated by `check fast` alone.
//   Gate 1 (judge):     product code changed and there is no judge PASS covering it  -> run the judge.
//   Gate 2 (eval):      harness files changed since the last eval baseline/result    -> run /eval.
//   Gate 3 (proposal):  harness files changed with no approved/applied proposal      -> revert or get approval.
// Gates 2 and 3 are inactive during Phase 0 bootstrap: no real baseline yet (missing or placeholder
// evals/baseline.json), a `.harness/BOOTSTRAP` marker file, or FIORE_HARNESS_BOOTSTRAP=1. Docs-only changes never trigger gate 1.
//
// "Judge PASS covers the change" = .harness/verdict.json has verdict PASS and either its `fingerprint`
// equals this script's fingerprint of the dirty code files (`node .cursor/hooks/stop-gate.mjs --fingerprint`),
// or verdict.json is newer than every dirty code file (so a different fingerprint algorithm in
// record-verdict.mjs cannot cause false alarms). Internal errors fail open.
import fs from 'node:fs';
import path from 'node:path';
import {
  currentBranch, dirtyFiles, emit, exists, fingerprint, git, hookLog, isCodeFile, isHarnessFile,
  mainRoot, mtimeMs, projectDir, readInput, readJson,
} from './lib.mjs';

const MAX_LISTED = 8;
const listFiles = (files) => files.slice(0, MAX_LISTED).join(', ') + (files.length > MAX_LISTED ? `, +${files.length - MAX_LISTED} more` : '');

function maxMtime(dir, files) {
  return files.reduce((m, f) => Math.max(m, fs.existsSync(path.join(dir, f)) ? mtimeMs(path.join(dir, f)) : 0), 0);
}

function judgeGate(dir, dirty) {
  const code = dirty.filter(isCodeFile);
  if (!code.length) return null;
  const verdict = readJson(path.join(dir, '.harness', 'verdict.json')) ?? readJson(path.join(mainRoot(dir), '.harness', 'verdict.json'));
  const verdictFile = [dir, mainRoot(dir)].map((r) => path.join(r, '.harness', 'verdict.json')).find(exists);
  if (verdict && String(verdict.verdict ?? '').toUpperCase() === 'PASS') {
    if (verdict.fingerprint && verdict.fingerprint === fingerprint(dir, code)) return null;
    if (verdictFile && mtimeMs(verdictFile) >= maxMtime(dir, code)) return null;
  }
  return `Judge gate: product code changed on main since the last judge PASS (${listFiles(code)}). ` +
    'Run the judge subagent once on the diff against the last checkpoint (task packet + docs/harness/judge-rubric.md), ' +
    'record it with `node scripts/harness/record-verdict.mjs --verdict PASS|FAIL --score <n>`, fix blockers only, then make the checkpoint commit.';
}

function harnessChanges(dir, dirty, baselineFile) {
  const changed = new Map(); // path -> latest change time (ms)
  for (const f of dirty.filter(isHarnessFile)) changed.set(f, mtimeMs(path.join(dir, f)));
  const baseCommit = git(['log', '-1', '--format=%H', '--', 'evals/baseline.json'], dir).stdout.trim();
  if (baseCommit) {
    const diff = git(['diff', '--name-only', `${baseCommit}..HEAD`], dir);
    for (const f of diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!isHarnessFile(f) || changed.has(f)) continue;
      const ct = Number(git(['log', '-1', '--format=%ct', `${baseCommit}..HEAD`, '--', f], dir).stdout.trim()) * 1000;
      changed.set(f, ct || Date.now());
    }
  }
  return changed;
}

function evalStamp(dir) {
  let stamp = mtimeMs(path.join(dir, 'evals', 'baseline.json'));
  const results = path.join(dir, 'evals', 'results');
  try {
    for (const n of fs.readdirSync(results)) if (n.endsWith('.json')) stamp = Math.max(stamp, mtimeMs(path.join(results, n)));
  } catch {
    // no results yet
  }
  return stamp;
}

function approvedProposals(dir) {
  const out = [];
  const pdir = path.join(mainRoot(dir), '.harness', 'proposals');
  let names = [];
  try {
    names = fs.readdirSync(pdir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!/^\d+-.*\.md$/.test(n)) continue;
    const text = fs.readFileSync(path.join(pdir, n), 'utf8');
    if (!/^\s*(?:[-*]\s*)?\**status\**\s*:\s*\**\s*(approved|applied)\b/im.test(text)) continue;
    const touches = [];
    const m = /^[ \t]*(?:touches|files)[ \t]*:[ \t]*(.*)$/im.exec(text);
    if (m) {
      touches.push(...m[1].split(',').map((s) => s.replace(/[`'"]/g, '').trim()).filter(Boolean));
      const after = text.slice(m.index + m[0].length).split('\n');
      for (const line of after) {
        const b = /^\s*[-*]\s+`?([^`\s]+)`?/.exec(line);
        if (!b) {
          if (line.trim() === '') continue;
          break;
        }
        touches.push(b[1]);
      }
    }
    out.push({ id: n.replace(/\.md$/, ''), touches });
  }
  return out;
}

function covered(file, proposals) {
  return proposals.some((p) => !p.touches.length || p.touches.some((t) => file === t || file.startsWith(t.endsWith('/') ? t : `${t}/`) || (t.endsWith('*') && file.startsWith(t.replace(/\*+$/, '')))));
}

// Bootstrap waiver for gates 2 and 3: env flag, `.harness/BOOTSTRAP` marker (delete it after W0.2),
// no baseline file, or a placeholder baseline (`status: placeholder` / `recorded: null`).
function bootstrapActive(dir, baselineFile) {
  if (process.env.FIORE_HARNESS_BOOTSTRAP === '1') return true;
  if (exists(path.join(mainRoot(dir), '.harness', 'BOOTSTRAP')) || exists(path.join(dir, '.harness', 'BOOTSTRAP'))) return true;
  if (!exists(baselineFile)) return true;
  const b = readJson(baselineFile);
  return !b || b.status === 'placeholder' || !b.recorded;
}

function harnessGates(dir, dirty) {
  const baselineFile = path.join(dir, 'evals', 'baseline.json');
  if (bootstrapActive(dir, baselineFile)) return [];
  const changed = harnessChanges(dir, dirty, baselineFile);
  if (!changed.size) return [];
  const messages = [];
  const stamp = evalStamp(dir);
  const stale = [...changed].filter(([, t]) => t > stamp).map(([f]) => f);
  if (stale.length) {
    messages.push(`Eval gate: harness files changed since the last eval (${listFiles(stale)}). Run \`/eval\` and compare with evals/baseline.json; a regression means revert the change.`);
  }
  const proposals = approvedProposals(dir);
  const unapproved = [...changed.keys()].filter((f) => !covered(f, proposals));
  if (unapproved.length) {
    messages.push(`Proposal gate: harness files changed without an approved proposal ID (${listFiles(unapproved)}). Revert them, or get the user's approval via a .harness/proposals/NNN-<slug>.md and /approve-proposal.`);
  }
  return messages;
}

async function main() {
  if (process.argv.includes('--fingerprint')) {
    const dir = process.cwd();
    process.stdout.write(`${fingerprint(dir, dirtyFiles(dir).filter(isCodeFile))}\n`);
    return;
  }
  const input = await readInput();
  if (input.status && input.status !== 'completed') return emit({});
  const dir = projectDir(input);
  const branch = currentBranch(dir);
  if (branch !== 'main') return emit({});

  const dirty = dirtyFiles(dir);
  const messages = [];
  const judge = judgeGate(dir, dirty);
  if (judge) messages.push(judge);
  messages.push(...harnessGates(dir, dirty));

  if (!messages.length) return emit({});
  hookLog(mainRoot(dir), 'stop-gate', `followup (${messages.length} gate(s)), loop_count=${input.loop_count ?? 0}`);
  emit({ followup_message: `Fiore stop gates (branch main):\n- ${messages.join('\n- ')}` });
}

main().catch(() => emit({}));
