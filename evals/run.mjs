#!/usr/bin/env node
// Purpose: grade Fiore harness evals. The Cursor IDE subscription executes each task
//          (/eval, /ship, executor). This script only prepares a worktree, grades a
//          finished one, or dry-grades the committed seed fixtures. No @cursor/sdk.
//          No CURSOR_API_KEY. Contract: docs/harness/README.md section 5.
//
// Usage:
//   node evals/run.mjs --list | --dry-run
//   node evals/run.mjs --prepare [<task-id> ...] [--base <ref>]
//   node evals/run.mjs --grade --manifest <prepare.json> | --grade --worktree <path> [--task <id>]
//   node evals/run.mjs --offline-grade [<task-id> ...] [--keep]
//   node evals/run.mjs --cleanup --manifest <prepare.json>
//   node evals/run.mjs --from <results.json> --write-baseline --yes
//   add --json, --concurrency <n>, --write-baseline --yes on grade / offline-grade
// Exit codes: 0 ok, 1 task failure or regression, 2 usage error, 3 budget exceeded (only).

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TASKS_DIR = path.join(HERE, "tasks");
const RESULTS_DIR = path.join(HERE, "results");
const BASELINE = path.join(HERE, "baseline.json");

const MAX_CONCURRENCY = 5;
const CALLS_REGRESSION_PCT = 30;
const LANES = ["XS", "S", "M", "L"];
// .harness is grader/run metadata. eval-hidden is copied by the grader after the snapshot.
const IGNORED_CHANGE_GLOBS = [".harness/**", "eval-hidden/**", "logs/**", "target/**", "node_modules/**"];

const OFFLINE_NOTE =
  "Baseline v0 is a grader dry-run of the committed seed fixtures (method offline-grade). No agent ran the prompts. Live pass, calls, and rubric stay null until /eval in the IDE grades a finished worktree and the user approves a refresh. Execution of that refresh is the Cursor IDE subscription (runner ide, mode harness-ide), not an API key.";

class UsageError extends Error {}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function git(args, cwd = REPO) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args, cwd = REPO) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}

function normPath(file) {
  return file.replaceAll("\\", "/");
}

function tail(text, n = 3000) {
  const s = String(text ?? "");
  return s.length > n ? `...${s.slice(-n)}` : s;
}

let gitLock = Promise.resolve();
function withGitLock(fn) {
  const next = gitLock.then(fn, fn);
  gitLock = next.catch(() => {});
  return next;
}

function stampNow() {
  return `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- minimal YAML subset
// Supports: comments, `key: scalar`, nested maps, block scalars (| |- > >-), lists of scalars,
// lists of maps (`- key: v` + continuation lines), inline lists `[a, b]`, quoted strings,
// numbers, booleans, null. Enough for evals/tasks/*.yaml; not a general YAML parser.

function parseYaml(text, file = "<yaml>") {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let pos = 0;
  const fail = (msg) => {
    throw new Error(`${file}:${pos + 1}: ${msg}`);
  };
  const indentOf = (s) => s.match(/^ */)[0].length;
  const isBlank = (s) => /^\s*(#.*)?$/.test(s);
  const skipBlank = () => {
    while (pos < lines.length && isBlank(lines[pos])) pos++;
  };

  function stripComment(s) {
    if (s.startsWith('"') || s.startsWith("'")) {
      const q = s[0];
      const end = s.indexOf(q, 1);
      if (end !== -1) return s.slice(0, end + 1);
    }
    const m = s.match(/\s+#/);
    return (m ? s.slice(0, m.index) : s).trim();
  }

  function splitInline(s) {
    const parts = [];
    let cur = "";
    let quote = null;
    for (const c of s) {
      if (quote) {
        cur += c;
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
        cur += c;
      } else if (c === ",") {
        parts.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    if (cur.trim() !== "") parts.push(cur.trim());
    return parts;
  }

  function scalar(raw) {
    const s = raw.trim();
    if (s === "" || s === "~" || s === "null") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s.startsWith("[") && s.endsWith("]")) return splitInline(s.slice(1, -1)).map(scalar);
    if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) {
      try {
        return JSON.parse(s);
      } catch {
        return s.slice(1, -1);
      }
    }
    if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  function blockScalar(style, parentIndent) {
    const body = [];
    while (pos < lines.length) {
      const ln = lines[pos];
      if (ln.trim() === "") {
        body.push("");
        pos++;
        continue;
      }
      if (indentOf(ln) <= parentIndent) break;
      body.push(ln);
      pos++;
    }
    const indents = body.filter((l) => l.trim() !== "").map(indentOf);
    const min = indents.length ? Math.min(...indents) : 0;
    const stripped = body.map((l) => l.slice(min));
    while (stripped.length && stripped[stripped.length - 1] === "") stripped.pop();
    let out = style.startsWith(">")
      ? stripped.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ")
      : stripped.join("\n");
    if (!style.endsWith("-")) out += "\n";
    return out;
  }

  function parseBlock(minIndent) {
    skipBlank();
    if (pos >= lines.length) return null;
    const ind = indentOf(lines[pos]);
    if (ind < minIndent) return null;
    return /^\s*-(\s|$)/.test(lines[pos]) ? parseList(ind) : parseMap(ind);
  }

  function parseList(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const ln = lines[pos];
      if (indentOf(ln) !== indent || !/^\s*-(\s|$)/.test(ln)) break;
      const rest = ln.trim().slice(1).trim();
      if (/^[A-Za-z0-9_.-]+:(\s|$)/.test(rest)) {
        lines[pos] = `${" ".repeat(indent + 2)}${rest}`;
        out.push(parseMap(indent + 2));
      } else {
        out.push(scalar(stripComment(rest)));
        pos++;
      }
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const ln = lines[pos];
      const ind = indentOf(ln);
      if (ind < indent) break;
      if (ind > indent) fail("unexpected indentation");
      const m = ln.trim().match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
      if (!m) fail(`expected "key: value", got "${ln.trim()}"`);
      pos++;
      const key = m[1];
      const rest = m[2] === undefined ? "" : stripComment(m[2].trim());
      if (/^[|>]-?$/.test(rest)) {
        out[key] = blockScalar(rest, indent);
      } else if (rest === "") {
        skipBlank();
        if (pos < lines.length) {
          const nIndent = indentOf(lines[pos]);
          const isItem = /^\s*-(\s|$)/.test(lines[pos]);
          if (nIndent > indent || (isItem && nIndent === indent)) {
            out[key] = parseBlock(nIndent);
            continue;
          }
        }
        out[key] = null;
      } else {
        out[key] = scalar(rest);
      }
    }
    return out;
  }

  const result = parseBlock(0);
  skipBlank();
  if (pos < lines.length) fail("trailing content could not be parsed");
  return result ?? {};
}

function loadTasks(filterIds) {
  if (!existsSync(TASKS_DIR)) throw new UsageError(`missing ${TASKS_DIR}`);
  const files = readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const tasks = [];
  for (const f of files) {
    const task = parseYaml(readFileSync(path.join(TASKS_DIR, f), "utf8"), f);
    validateTask(task, f);
    tasks.push(task);
  }
  if (filterIds.length) {
    const unknown = filterIds.filter((id) => !tasks.some((t) => t.id === id));
    if (unknown.length) {
      throw new UsageError(
        `unknown task id(s): ${unknown.join(", ")}. Available: ${tasks.map((t) => t.id).join(", ")}`,
      );
    }
    return tasks.filter((t) => filterIds.includes(t.id));
  }
  return tasks;
}

function validateTask(t, file) {
  const need = (cond, msg) => {
    if (!cond) throw new Error(`${file}: ${msg}`);
  };
  need(typeof t.id === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id), "id must be lowercase kebab");
  need(`${t.id}.yaml` === file, `id "${t.id}" must match file name`);
  need(typeof t.prompt === "string" && t.prompt.trim(), "prompt is required");
  need(LANES.includes(t.expected_lane), `expected_lane must be one of ${LANES.join("|")}`);
  need(typeof t.base_commit === "string", "base_commit is required (tag or sha)");
  need(t.budget && Number.isFinite(t.budget.max_calls), "budget.max_calls is required");
  for (const key of ["hidden_tests", "seed_files"]) {
    for (const e of t[key] ?? []) {
      need(e && typeof e.src === "string" && typeof e.dest === "string", `${key} entries need src and dest`);
      need(existsSync(path.join(REPO, e.src)), `${key}: missing source ${e.src}`);
      need(!path.isAbsolute(e.dest) && !e.dest.split("/").includes(".."), `${key}: unsafe dest ${e.dest}`);
    }
  }
  need(["none", "quick", "full", undefined].includes(t.expected_judge), "expected_judge must be none|quick|full");
}

let psExe;
function powershell() {
  if (psExe) return psExe;
  psExe = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 ? "pwsh" : "powershell";
  return psExe;
}

function runCmd(command, cwd, timeoutMs = 600_000) {
  const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs });
  return { code: r.status ?? (r.error ? 124 : 1), out: tail(`${r.stdout ?? ""}${r.stderr ?? ""}`) };
}

function runCheckFull(cwd) {
  const script = path.join(cwd, "scripts", "check.ps1");
  if (!existsSync(script)) return { skipped: true, code: 0, out: "scripts/check.ps1 not present at base commit" };
  const r = spawnSync(
    powershell(),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Tier", "full"],
    { cwd, encoding: "utf8", timeout: 1_200_000 },
  );
  return { code: r.status ?? 1, out: tail(`${r.stdout ?? ""}${r.stderr ?? ""}`) };
}

function resolveBase(task, override, quiet = false) {
  const ref = override ?? task.base_commit;
  const sha = tryGit(["rev-parse", "--verify", `${ref}^{commit}`]);
  if (sha) return { ref, sha, fallback: false };
  const head = tryGit(["rev-parse", "HEAD"]);
  if (!head) throw new Error(`cannot resolve base "${ref}" and the repo has no HEAD`);
  if (!quiet) log(`warn: base "${ref}" not found; falling back to HEAD ${head.slice(0, 8)} (results are not reproducible)`);
  return { ref, sha: head, fallback: true };
}

function copyEntry(entry, wt) {
  const dest = path.join(wt, ...entry.dest.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.join(REPO, entry.src), dest, { recursive: true });
}

function listChangedFiles(wt, sinceSha) {
  const changed = [];
  const out = git(["diff", "--name-status", "--no-renames", sinceSha], wt);
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    const file = normPath(rest.join("\t"));
    if (!matchesAny(file, IGNORED_CHANGE_GLOBS)) changed.push({ status, file });
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard"], wt);
  for (const raw of untracked.split("\n").filter(Boolean)) {
    const file = normPath(raw);
    if (!matchesAny(file, IGNORED_CHANGE_GLOBS) && !changed.some((c) => c.file === file)) {
      changed.push({ status: "?", file });
    }
  }
  return changed;
}

async function createWorktree(task, base, stamp) {
  const branch = `task/eval-${task.id}-${stamp}`;
  const wt = path.join(os.tmpdir(), "fiore-evals", `${task.id}-${stamp}`);
  await withGitLock(() => {
    mkdirSync(path.dirname(wt), { recursive: true });
    git(["worktree", "add", "-b", branch, wt, base.sha]);
  });
  try {
    let seedSha = base.sha;
    if ((task.seed_files ?? []).length) {
      for (const e of task.seed_files) copyEntry(e, wt);
      git(["add", "-A"], wt);
      // Throwaway seed commit in the eval worktree. Identity is per-command so repo config stays untouched.
      git(
        ["-c", "user.name=fiore-eval", "-c", "user.email=eval@fiore.invalid", "commit", "-m", "eval: seed task files"],
        wt,
      );
      seedSha = git(["rev-parse", "HEAD"], wt);
    }
    const meta = {
      taskId: task.id,
      baseRef: base.ref,
      baseSha: base.sha,
      seedSha,
      branch,
      mode: "harness-ide",
    };
    const metaPath = path.join(wt, ".harness", "eval-meta.json");
    mkdirSync(path.dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    return { wt, branch, seedSha, meta };
  } catch (e) {
    await removeWorktree(wt, branch);
    throw e;
  }
}

async function removeWorktree(wt, branch) {
  await withGitLock(() => {
    try {
      git(["worktree", "remove", "--force", wt]);
    } catch {
      rmSync(wt, { recursive: true, force: true });
      tryGit(["worktree", "prune"]);
    }
    tryGit(["branch", "-D", branch]);
  });
}

function newestJson(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) return null;
  try {
    return { name: files[0].f, data: JSON.parse(readFileSync(path.join(dir, files[0].f), "utf8")) };
  } catch {
    return null;
  }
}

function readJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readRunState(wt) {
  const r = newestJson(path.join(wt, ".harness", "runs"));
  if (!r) return null;
  const d = r.data;
  const calls = typeof d.calls === "number" ? d.calls : null;
  const byRole = d.callsByRole && typeof d.callsByRole === "object" ? d.callsByRole : {};
  const callLog = Array.isArray(d.callLog) ? d.callLog : [];
  const roles = callLog.length
    ? callLog.map((c) => c?.role).filter(Boolean)
    : Object.entries(byRole).flatMap(([role, n]) => Array(Number(n) || 0).fill(role));
  const history = Array.isArray(d.history) ? d.history : [];
  const stateOf = (h) => (typeof h === "string" ? h : (h?.to ?? h?.state));
  const judgeFromRole = Number(byRole.judge);
  return {
    runId: d.runId ?? d.id ?? r.name.replace(/\.json$/, ""),
    lane: LANES.includes(d.lane) ? d.lane : null,
    state: d.state ?? null,
    calls,
    debugEntries:
      typeof d.debugEntries === "number" ? d.debugEntries : history.filter((h) => stateOf(h) === "debug").length,
    callRoles: roles,
    judgeCalls: Number.isFinite(judgeFromRole) ? judgeFromRole : roles.filter((role) => role === "judge").length,
  };
}

function readVerdict(wt) {
  const d = readJson(path.join(wt, ".harness", "verdict.json"));
  if (!d) return null;
  const score = Number(d.score ?? d.total);
  return { verdict: d.verdict ?? null, score: Number.isFinite(score) ? score : null };
}

function readEvalResult(wt) {
  const p = path.join(wt, ".harness", "eval-result.txt");
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  const m = text.match(/EVAL-RESULT\s+lane=(XS|S|M|L)(?:\s+run=(\S+))?/);
  if (!m) return { lane: null, run: null };
  return { lane: m[1], run: m[2] ?? null };
}

function readMeta(wt) {
  return readJson(path.join(wt, ".harness", "eval-meta.json"));
}

// offline: agent-dependent graders are informational. Hidden tests and check.ps1 still run on the seed.
function grade(task, ctx) {
  const { changed, runState, verdict, checkRes, hiddenRes, evalResult, mode } = ctx;
  const offline = mode === "offline-grade";
  const g = [];
  const add = (name, pass, detail) => g.push({ name, pass, detail });
  const enabled = (k) => task.graders?.[k] !== false;

  if (offline) {
    add("agent_finished", null, "offline-grade of seed fixtures; no IDE agent ran");
  } else {
    const state = runState?.state ?? null;
    const finished = state === "done" || (!runState && Boolean(evalResult?.lane));
    add(
      "agent_finished",
      finished,
      finished ? `state ${state ?? "eval-result"}` : `state ${state ?? "missing"} (expected done, or .harness/eval-result.txt when no run file exists)`,
    );
  }

  if (enabled("check_full")) {
    add("check_full", checkRes.skipped ? null : checkRes.code === 0, checkRes.skipped ? checkRes.out : `exit ${checkRes.code}`);
  }
  let hiddenPass = null;
  if (enabled("hidden_tests") && (task.hidden_commands ?? []).length) {
    const bad = hiddenRes.find((h) => h.code !== 0);
    hiddenPass = !bad;
    add("hidden_tests", hiddenPass, bad ? `failed: ${bad.command}` : `${hiddenRes.length} command(s) passed`);
  }

  if (offline) {
    add("scope", null, changed.length ? `${changed.length} file(s) differ from the seed (unexpected for offline-grade)` : "seed fixtures only; scope is graded on a live IDE run");
  } else {
    const outside = (task.allowed_paths ?? []).length
      ? changed.filter((c) => !matchesAny(c.file, task.allowed_paths))
      : [];
    const deletedProtected = changed.filter((c) => c.status === "D" && matchesAny(c.file, task.protected_paths ?? []));
    const scopeBad = [...outside, ...deletedProtected];
    const noChange = changed.length === 0;
    add(
      "scope",
      !scopeBad.length && !noChange,
      noChange
        ? "no files changed"
        : scopeBad.length
          ? `out of scope: ${scopeBad.map((c) => c.file).join(", ")}`
          : `${changed.length} file(s) changed`,
    );
  }

  const lane = offline ? null : (runState?.lane ?? evalResult?.lane ?? null);
  if (offline) {
    add("lane_correct", null, `expected ${task.expected_lane}; lane comes from .harness/runs or eval-result.txt on a live run`);
  } else if (enabled("lane_correct")) {
    add("lane_correct", lane === task.expected_lane, `expected ${task.expected_lane}, got ${lane ?? "unknown"}`);
  }

  const roles = runState?.callRoles ?? [];
  const judgeCalls = runState?.judgeCalls ?? roles.filter((r) => r === "judge").length;
  const expectedJudge = task.expected_judge ?? (task.expected_lane === "XS" ? "none" : "full");
  if (offline) {
    add("judge_policy", null, "judge artifacts are graded on a live IDE run");
  } else if (expectedJudge === "none") {
    add("judge_policy", judgeCalls === 0, judgeCalls === 0 ? "judge skipped as expected" : `judge ran ${judgeCalls}x but expected none`);
  } else if (task.graders?.rubric_min != null) {
    const min = task.graders.rubric_min;
    if (!verdict) add("rubric", false, "judge expected but no .harness/verdict.json");
    else add("rubric", verdict.verdict !== "FAIL" && (verdict.score ?? 0) >= min, `${verdict.verdict ?? "?"} score ${verdict.score ?? "?"} (min ${min})`);
  }

  const missingRoles = (task.expected_roles ?? []).filter((r) => !roles.includes(r));
  if (offline) {
    if ((task.expected_roles ?? []).length) add("routing", null, "roles are graded on a live IDE run");
  } else if ((task.expected_roles ?? []).length) {
    add("routing", !missingRoles.length, missingRoles.length ? `role(s) never called: ${missingRoles.join(", ")}` : `called: ${[...new Set(roles)].join(", ")}`);
  }

  const calls = offline ? null : (runState?.calls ?? null);
  const retries = offline ? null : Math.max(roles.filter((r) => r === "debugger").length, runState?.debugEntries ?? 0);
  const escalated = runState?.state === "escalate";
  const overCalls = !offline && (calls == null || calls > task.budget.max_calls);
  const overRetries = !offline && task.budget.max_retries != null && retries > task.budget.max_retries;
  if (offline) {
    add("within_budget", null, "budget is graded on a live IDE run");
  } else if (enabled("within_budget")) {
    add(
      "within_budget",
      !overCalls && !overRetries && !escalated,
      `calls ${calls ?? "?"}/${task.budget.max_calls}, retries ${retries}/${task.budget.max_retries ?? "-"}${escalated ? ", escalated" : ""}`,
    );
  }

  g.push({ name: "wall_time", pass: null, informational: true, detail: "not measured (the agent runs in the IDE)" });

  const livePass = g.every((x) => x.pass !== false);
  return {
    pass: offline ? null : livePass,
    live: !offline,
    graders: g,
    metrics: {
      lane,
      calls,
      retries,
      rubric: offline ? null : (verdict?.score ?? null),
      wallMs: null,
    },
    fixture: {
      hiddenPass,
      checkPass: checkRes.skipped ? null : checkRes.code === 0,
    },
    budgetExceeded: !offline && (overCalls || overRetries || escalated),
    roles,
  };
}

async function gradeWorktree(task, wt, mode) {
  const meta = readMeta(wt);
  const seedSha = meta?.seedSha ?? tryGit(["rev-parse", "HEAD"], wt);
  if (!seedSha) throw new Error(`cannot resolve seed commit in ${wt}`);
  const changed = listChangedFiles(wt, seedSha);
  for (const e of task.hidden_tests ?? []) copyEntry(e, wt);
  const checkRes = runCheckFull(wt);
  const hiddenRes = (task.hidden_commands ?? []).map((command) => ({ command, ...runCmd(command, wt) }));
  const runState = readRunState(wt);
  const verdict = readVerdict(wt);
  const evalResult = readEvalResult(wt);
  const graded = grade(task, { changed, runState, verdict, checkRes, hiddenRes, evalResult, mode });
  return {
    id: task.id,
    base: meta ? { ref: meta.baseRef, sha: meta.baseSha, fallback: false } : null,
    expectedLane: task.expected_lane,
    worktree: wt,
    branch: meta?.branch ?? null,
    seedSha,
    changed,
    status: mode === "offline-grade" ? "offline-grade" : (runState?.state ?? "graded"),
    runId: runState?.runId ?? evalResult?.run ?? null,
    checkOutput: checkRes.out,
    hiddenOutput: hiddenRes.map((h) => ({ command: h.command, code: h.code, out: h.out })),
    ...graded,
  };
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch {
    return null;
  }
}

function compareToBaseline(baseline, results) {
  const regressions = [];
  const notes = [];
  for (const r of results) {
    const b = baseline?.tasks?.[r.id];
    if (!b || b.pass == null) {
      notes.push(`${r.id}: no live baseline yet (pass is null until an IDE /eval is approved)`);
      continue;
    }
    if (r.pass == null) {
      notes.push(`${r.id}: this run has no live pass/fail (offline-grade); not compared`);
      continue;
    }
    if (b.pass && !r.pass) regressions.push({ task: r.id, metric: "pass", from: true, to: false });
    const pct = baseline.thresholds?.callsIncreasePct ?? CALLS_REGRESSION_PCT;
    if (b.calls != null && r.metrics.calls != null && r.metrics.calls > b.calls * (1 + pct / 100)) {
      regressions.push({ task: r.id, metric: "calls", from: b.calls, to: r.metrics.calls });
    }
    if (b.rubric != null && r.metrics.rubric != null && r.metrics.rubric < b.rubric) {
      regressions.push({ task: r.id, metric: "rubric", from: b.rubric, to: r.metrics.rubric });
    }
  }
  return { regressions, notes };
}

function writeBaseline(results, meta) {
  const existing = loadBaseline() ?? {};
  const tasks = {};
  for (const r of results) {
    tasks[r.id] = {
      pass: r.pass,
      lane: r.metrics?.lane ?? null,
      calls: r.metrics?.calls ?? null,
      retries: r.metrics?.retries ?? null,
      rubric: r.metrics?.rubric ?? null,
      wallMs: r.metrics?.wallMs ?? null,
      expectedLane: r.expectedLane ?? null,
      live: r.live === true,
      fixtureHiddenPass: r.fixture?.hiddenPass ?? null,
      fixtureCheckPass: r.fixture?.checkPass ?? null,
    };
  }
  for (const [id, prev] of Object.entries(existing.tasks ?? {})) {
    if (!tasks[id]) tasks[id] = prev;
  }
  const next = {
    version: 1,
    status: "recorded",
    recorded: new Date().toISOString(),
    approvedBy: meta.approvedBy ?? null,
    method: meta.method,
    mode: meta.mode ?? "harness-ide",
    runner: meta.runner ?? "ide",
    sdk: null,
    model: meta.model ?? null,
    base: meta.base ?? null,
    note: meta.note,
    thresholds: existing.thresholds ?? {
      callsIncreasePct: 30,
      rubricMayDrop: false,
      passMayBecomeFail: false,
    },
    tasks,
  };
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
}

function resultsPath(stamp) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  return path.join(RESULTS_DIR, `${day}-${stamp.slice(8, 14)}.json`);
}

function writeResults(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function printSummary(results, cmp) {
  const pad = (s, n) => String(s).padEnd(n);
  const live = results.filter((r) => r.pass != null);
  const pass = live.filter((r) => r.pass).length;
  const fail = live.filter((r) => !r.pass).length;
  const offline = results.length - live.length;
  console.log(`Eval ${new Date().toISOString().slice(0, 10)}: ${results.length} tasks, ${pass} pass, ${fail} fail, ${offline} offline`);
  console.log(`${pad("task", 28)}${pad("lane(exp/act)", 15)}${pad("calls", 8)}${pad("rubric", 8)}result`);
  for (const r of results) {
    const label = r.pass == null ? "OFFLINE" : r.pass ? "PASS" : "FAIL";
    console.log(
      `${pad(r.id, 28)}${pad(`${r.expectedLane}/${r.metrics?.lane ?? "-"}`, 15)}${pad(r.metrics?.calls ?? "-", 8)}${pad(r.metrics?.rubric ?? "-", 8)}${label}`,
    );
    for (const g of r.graders.filter((x) => x.pass === false)) {
      console.log(`    ${r.pass == null ? "fixture" : "x"} ${g.name}: ${g.detail}`);
    }
  }
  for (const n of cmp.notes) console.log(`note: ${n}`);
  console.log(`Regressions: ${cmp.regressions.length ? cmp.regressions.map((x) => `${x.task} ${x.metric} ${x.from}->${x.to}`).join("; ") : "none"}`);
}

function exitCode(results, cmp) {
  if (cmp.regressions.length) return 1;
  const hard = results.filter((r) => r.pass === false);
  if (!hard.length) return 0;
  const onlyBudget = hard.every(
    (r) => r.budgetExceeded && r.graders.filter((g) => g.pass === false).every((g) => g.name === "within_budget"),
  );
  return onlyBudget ? 3 : 1;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

function metaFor(method, results, extra = {}) {
  return {
    method,
    mode: "harness-ide",
    runner: "ide",
    sdk: null,
    model: null,
    base: results[0]?.base?.sha ?? results.find((r) => r.base?.sha)?.base?.sha ?? null,
    ...extra,
  };
}

async function publish(results, opts, meta) {
  const baseline = loadBaseline();
  const cmp = compareToBaseline(baseline, results);
  const outFile = resultsPath(opts.stamp ?? stampNow());
  writeResults(outFile, { date: new Date().toISOString(), ...meta, results, comparison: cmp });
  if (opts.writeBaseline) {
    writeBaseline(results, meta);
    log(`baseline written: ${BASELINE}`);
  }
  if (opts.json) console.log(JSON.stringify({ file: outFile, results, comparison: cmp }, null, 2));
  else {
    printSummary(results, cmp);
    console.log(`results: ${outFile}`);
  }
  return exitCode(results, cmp);
}

async function prepare(opts) {
  const tasks = loadTasks(opts.ids);
  const stamp = opts.stamp;
  const entries = [];
  for (const task of tasks) {
    const base = resolveBase(task, opts.base);
    const info = await createWorktree(task, base, stamp);
    entries.push({
      id: task.id,
      worktree: info.wt,
      branch: info.branch,
      seedSha: info.seedSha,
      baseSha: base.sha,
      baseRef: base.ref,
      fallback: base.fallback,
      expectedLane: task.expected_lane,
      prompt: task.prompt.trim(),
    });
    log(`[${task.id}] worktree ${info.wt}`);
  }
  const manifest = { stamp, mode: "harness-ide", runner: "ide", tasks: entries };
  const file = path.join(RESULTS_DIR, `prepare-${stamp}.json`);
  writeResults(file, manifest);
  console.log(file);
  console.log("Execute each prompt with /ship in that worktree (IDE subscription). Then: node evals/run.mjs --grade --manifest <file>");
  return 0;
}

async function cleanup(opts) {
  const manifest = readJson(opts.manifest);
  if (!manifest?.tasks) throw new UsageError(`cannot read manifest ${opts.manifest}`);
  for (const t of manifest.tasks) {
    if (t.worktree && t.branch) await removeWorktree(t.worktree, t.branch);
  }
  log(`removed ${manifest.tasks.length} worktree(s)`);
  return 0;
}

async function gradeManifest(opts) {
  const tasks = loadTasks([]);
  let jobs;
  if (opts.manifest) {
    const manifest = readJson(opts.manifest);
    if (!manifest?.tasks) throw new UsageError(`cannot read manifest ${opts.manifest}`);
    jobs = manifest.tasks.map((entry) => {
      const task = tasks.find((t) => t.id === entry.id);
      if (!task) throw new UsageError(`manifest task "${entry.id}" is not in evals/tasks`);
      if (!entry.worktree || !existsSync(entry.worktree)) throw new UsageError(`worktree missing for ${entry.id}: ${entry.worktree}`);
      return { task, wt: entry.worktree };
    });
  } else if (opts.worktree) {
    if (!existsSync(opts.worktree)) throw new UsageError(`worktree not found: ${opts.worktree}`);
    const meta = readMeta(opts.worktree);
    const id = opts.task ?? meta?.taskId;
    if (!id) throw new UsageError("--grade --worktree needs --task when .harness/eval-meta.json has no taskId");
    if (opts.task && meta?.taskId && opts.task !== meta.taskId) {
      throw new UsageError(`--task ${opts.task} does not match worktree meta taskId ${meta.taskId}`);
    }
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new UsageError(`unknown task id: ${id}`);
    jobs = [{ task, wt: opts.worktree }];
  } else {
    throw new UsageError("--grade needs --manifest <file> or --worktree <path>");
  }
  const results = await pool(jobs, opts.concurrency, async ({ task, wt }) => {
    try {
      const graded = await gradeWorktree(task, wt, "harness-ide");
      log(`[${task.id}] ${graded.pass ? "PASS" : "FAIL"}`);
      return graded;
    } catch (e) {
      log(`[${task.id}] FAIL`);
      return {
        id: task.id,
        expectedLane: task.expected_lane,
        pass: false,
        live: true,
        status: "error",
        error: e.message,
        graders: [{ name: "runner", pass: false, detail: e.message }],
        metrics: { lane: null, calls: null, retries: null, rubric: null, wallMs: null },
        fixture: { hiddenPass: null, checkPass: null },
        base: null,
      };
    }
  });
  const meta = metaFor("harness-ide", results, {
    note: "Live IDE grade. The agent ran in the Cursor IDE; this file is the grader output.",
    approvedBy: opts.writeBaseline ? "user (--write-baseline --yes)" : null,
  });
  return publish(results, opts, meta);
}

async function offlineGrade(opts) {
  const tasks = loadTasks(opts.ids);
  const stamp = opts.stamp;
  const results = await pool(tasks, opts.concurrency, async (task) => {
    const base = resolveBase(task, opts.base);
    let info;
    try {
      info = await createWorktree(task, base, `${stamp}-${task.id.slice(0, 8)}`);
      const graded = await gradeWorktree(task, info.wt, "offline-grade");
      graded.base = { ref: base.ref, sha: base.sha, fallback: base.fallback };
      log(`[${task.id}] OFFLINE hidden=${graded.fixture.hiddenPass} check=${graded.fixture.checkPass}`);
      return graded;
    } catch (e) {
      log(`[${task.id}] OFFLINE error`);
      return {
        id: task.id,
        expectedLane: task.expected_lane,
        pass: null,
        live: false,
        status: "error",
        error: e.message,
        graders: [{ name: "runner", pass: false, detail: e.message }],
        metrics: { lane: null, calls: null, retries: null, rubric: null, wallMs: null },
        fixture: { hiddenPass: null, checkPass: null },
        base: { ref: base.ref, sha: base.sha, fallback: base.fallback },
      };
    } finally {
      if (info && !opts.keep) await removeWorktree(info.wt, info.branch);
    }
  });
  const meta = metaFor("offline-grade", results, {
    note: OFFLINE_NOTE,
    approvedBy: opts.writeBaseline ? "user directive 2026-11-07" : null,
  });
  return publish(results, opts, meta);
}

function fromResults(opts) {
  const doc = readJson(opts.from);
  if (!doc?.results) throw new UsageError(`cannot read results ${opts.from}`);
  writeBaseline(doc.results, {
    method: doc.method ?? "harness-ide",
    mode: doc.mode ?? "harness-ide",
    runner: doc.runner ?? "ide",
    model: doc.model ?? null,
    base: doc.base ?? null,
    note: doc.note ?? "Recorded from an existing results file.",
    approvedBy: "user (--write-baseline --yes)",
  });
  log(`baseline written from ${opts.from}: ${BASELINE}`);
  return 0;
}

const HELP = `Usage: node evals/run.mjs <mode> [<task-id> ...]

Modes (this process never calls an agent and never reads an API key):
  --list                         list tasks
  --dry-run                      validate task YAML
  --prepare                      cut worktrees, copy seeds, write a manifest
  --grade --manifest <file>      grade worktrees from --prepare
  --grade --worktree <path>      grade one finished worktree (--task if no meta)
  --offline-grade                grade committed seed fixtures; live metrics stay null
  --cleanup --manifest <file>    remove worktrees from --prepare
  --from <results.json>          with --write-baseline --yes, record that file

Flags: --base <ref>  --concurrency <n>  --keep  --json  --write-baseline --yes
Execute tasks with /eval in the IDE (subscription). See .cursor/skills/eval/SKILL.md.
`;

function parseArgs(argv) {
  const o = { ids: [], concurrency: 1, stamp: stampNow() };
  const modes = [];
  const val = (i, flag) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--concurrency") o.concurrency = Number(val(i++, a));
    else if (a === "--base") o.base = val(i++, a);
    else if (a === "--worktree") o.worktree = val(i++, a);
    else if (a === "--manifest") o.manifest = val(i++, a);
    else if (a === "--task") o.task = val(i++, a);
    else if (a === "--from") o.from = val(i++, a);
    else if (a === "--keep") o.keep = true;
    else if (a === "--json") o.json = true;
    else if (a === "--dry-run") modes.push("dry-run");
    else if (a === "--list") modes.push("list");
    else if (a === "--prepare") modes.push("prepare");
    else if (a === "--grade") modes.push("grade");
    else if (a === "--offline-grade") modes.push("offline-grade");
    else if (a === "--cleanup") modes.push("cleanup");
    else if (a === "--write-baseline") o.writeBaseline = true;
    else if (a === "--yes") o.yes = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
    else o.ids.push(a);
  }
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new UsageError("--concurrency must be a positive integer");
  if (o.concurrency > MAX_CONCURRENCY) {
    log(`warn: concurrency capped at ${MAX_CONCURRENCY}`);
    o.concurrency = MAX_CONCURRENCY;
  }
  if (o.writeBaseline && !o.yes) {
    throw new UsageError("--write-baseline requires --yes (the baseline changes only after the user approves)");
  }
  const unique = [...new Set(modes)];
  if (unique.length > 1) throw new UsageError(`choose one mode, got ${unique.join(", ")}`);
  o.mode = unique[0] ?? (o.from ? "from" : null);
  if (o.writeBaseline && o.mode && !["grade", "offline-grade", "from"].includes(o.mode)) {
    throw new UsageError("--write-baseline is only valid with --grade, --offline-grade, or --from");
  }
  if (o.mode === "from" && !o.writeBaseline) throw new UsageError("--from requires --write-baseline --yes");
  if (o.mode === "cleanup" && !o.manifest) throw new UsageError("--cleanup needs --manifest <file>");
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!opts.mode) throw new UsageError(`evals/run.mjs only grades. Execute tasks with /eval in the IDE.\n${HELP}`);

  if (opts.mode === "list" || opts.mode === "dry-run") {
    const tasks = loadTasks(opts.ids);
    for (const t of tasks) {
      const base = (() => {
        try {
          return resolveBase(t, opts.base, true);
        } catch {
          return null;
        }
      })();
      console.log(`${t.id}  lane=${t.expected_lane}  judge=${t.expected_judge ?? "-"}  budget=${t.budget.max_calls}calls  base=${t.base_commit}${base?.fallback ? " (unresolved)" : ""}`);
    }
    if (opts.mode === "dry-run") log(`dry run ok: ${tasks.length} task(s) parsed and validated; nothing executed`);
    return 0;
  }
  if (opts.mode === "prepare") return prepare(opts);
  if (opts.mode === "cleanup") return cleanup(opts);
  if (opts.mode === "grade") return gradeManifest(opts);
  if (opts.mode === "offline-grade") return offlineGrade(opts);
  if (opts.mode === "from") return fromResults(opts);
  throw new UsageError(`unknown mode ${opts.mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      if (e instanceof UsageError) {
        log(`error: ${e.message}`);
        process.exit(2);
      }
      log(`fatal: ${e.stack ?? e.message}`);
      process.exit(1);
    },
  );
}

export {
  parseYaml,
  loadTasks,
  createWorktree,
  removeWorktree,
  listChangedFiles,
  grade,
  readRunState,
  copyEntry,
  runCmd,
  runCheckFull,
  globToRegExp,
};
