#!/usr/bin/env node
// Purpose: Fiore harness eval runner. Runs each task in evals/tasks/*.yaml through /ship in a fresh git
//          worktree (local @cursor/sdk agent), grades the result, compares with evals/baseline.json.
// Contract: docs/harness/README.md section 5. Format: evals/tasks/README.md.
// Needs CURSOR_API_KEY in the environment (never read from a file). `--dry-run` and `--list` do not.
//
// Usage:
//   node evals/run.mjs [<task-id> ...] [--concurrency <n>] [--model <id>] [--base <ref>]
//                      [--timeout <seconds>] [--keep] [--json] [--dry-run] [--list]
//                      [--write-baseline --yes]
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

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5; // harness cap for local agents
const DEFAULT_MODEL = "composer-2.5"; // orchestrator model; override with --model or FIORE_EVAL_MODEL
const DEFAULT_TIMEOUT_S = 900;
const CALLS_REGRESSION_PCT = 30;
const LANES = ["XS", "S", "M", "L"];
// Files the harness itself writes inside a worktree; never counted as task changes.
const IGNORED_CHANGE_GLOBS = [".harness/**", "logs/**", "target/**", "node_modules/**"];

// ---------------------------------------------------------------- utilities

class UsageError extends Error {}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function git(args, cwd = REPO, opts = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
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

function tail(text, n = 3000) {
  const s = String(text ?? "");
  return s.length > n ? `...${s.slice(-n)}` : s;
}

// Serializes git operations that take repo-wide locks (worktree add/remove).
let gitLock = Promise.resolve();
function withGitLock(fn) {
  const next = gitLock.then(fn, fn);
  gitLock = next.catch(() => {});
  return next;
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
        // list item that opens a map: re-indent the line as a map entry and parse the map
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

// ---------------------------------------------------------------- task loading

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

// ---------------------------------------------------------------- shell helpers

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

// ---------------------------------------------------------------- worktree handling

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
  git(["add", "-A"], wt);
  const out = git(["diff", "--cached", "--name-status", "--no-renames", sinceSha], wt);
  const changed = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    const file = rest.join("\t");
    if (!matchesAny(file, IGNORED_CHANGE_GLOBS)) changed.push({ status, file });
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
  let seedSha = base.sha;
  if ((task.seed_files ?? []).length) {
    for (const e of task.seed_files) copyEntry(e, wt);
    git(["add", "-A"], wt);
    git(
      ["-c", "user.name=fiore-eval", "-c", "user.email=eval@fiore.invalid", "commit", "-q", "--no-verify", "-m", "eval: seed task files"],
      wt,
    );
    seedSha = git(["rev-parse", "HEAD"], wt);
  }
  return { wt, branch, seedSha };
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

// ---------------------------------------------------------------- run artifacts (best effort)

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

function readRunState(wt) {
  const r = newestJson(path.join(wt, ".harness", "runs"));
  if (!r) return null;
  const d = r.data;
  const callsRaw = d.calls ?? d.callCount ?? d.subagentCalls;
  const calls =
    typeof callsRaw === "number"
      ? callsRaw
      : Array.isArray(callsRaw)
        ? callsRaw.length
        : typeof callsRaw?.total === "number"
          ? callsRaw.total
          : null;
  const history = Array.isArray(d.history) ? d.history : Array.isArray(d.transitions) ? d.transitions : [];
  const stateOf = (h) => (typeof h === "string" ? h : (h?.state ?? h?.to));
  return {
    runId: d.id ?? d.runId ?? r.name.replace(/\.json$/, ""),
    lane: LANES.includes(d.lane) ? d.lane : null,
    state: d.state ?? null,
    calls,
    debugEntries: history.filter((h) => stateOf(h) === "debug").length,
    callRoles: Array.isArray(callsRaw) ? callsRaw.map((c) => c?.role ?? c) : [],
  };
}

function readVerdict(wt) {
  const p = path.join(wt, ".harness", "verdict.json");
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const score = Number(d.score ?? d.total);
    return { verdict: d.verdict ?? null, score: Number.isFinite(score) ? score : null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the agent run

async function loadSdk() {
  try {
    return await import("@cursor/sdk");
  } catch (e) {
    throw new UsageError(
      `cannot load @cursor/sdk (${e.code ?? e.message}). Install it once: npm ci --prefix evals`,
    );
  }
}

function buildPrompt(task) {
  return [
    `/ship ${task.prompt.trim()}`,
    "",
    "(Eval run, non-interactive. Follow the ship skill in .cursor/skills/ship/SKILL.md exactly, including run-state and budgets. Do not ask questions; do not commit or push.",
    "End your final reply with one line: `EVAL-RESULT lane=<XS|S|M|L> run=<run-id>`.)",
  ].join("\n");
}

async function runAgent(sdk, task, ctx, wt) {
  const stats = { calls: new Map(), text: "", status: "error", error: null, durationMs: 0, agentId: null, runId: null };
  const started = Date.now();
  const timeoutMs = (ctx.timeoutS ?? task.budget.max_wall_seconds ?? DEFAULT_TIMEOUT_S) * 1000;
  const agent = await sdk.Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: ctx.model },
    name: `fiore-eval ${task.id}`,
    local: { cwd: wt, settingSources: ["project"] },
  });
  try {
    const run = await agent.send(buildPrompt(task));
    stats.agentId = agent.agentId;
    stats.runId = run.id;
    log(`[${task.id}] started agent=${agent.agentId} run=${run.id}`);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      run.cancel().catch(() => {});
    }, timeoutMs);

    const noteCall = (id, name, args) => {
      if (name !== "task" || !id || stats.calls.has(id)) return;
      const a = args && typeof args === "object" ? args : {};
      stats.calls.set(id, String(a.subagent_type ?? a.subagentType ?? a.agent ?? "unknown"));
    };
    const consume = (async () => {
      for await (const ev of run.stream()) {
        if (ev.type === "tool_call") noteCall(ev.call_id, ev.name, ev.args);
        else if (ev.type === "assistant") {
          for (const b of ev.message.content) {
            if (b.type === "text") stats.text += b.text;
            else if (b.type === "tool_use") noteCall(b.id, b.name, b.input);
          }
        }
      }
    })().catch((e) => {
      stats.error = `stream: ${e.message}`;
    });

    const result = await run.wait();
    await consume;
    clearTimeout(timer);
    stats.status = timedOut ? "timeout" : result.status;
    if (result.error && !stats.error) stats.error = result.error.message;
    stats.finalText = tail(result.result ?? stats.text, 2000);
    stats.usage = result.usage ?? null;
  } finally {
    stats.durationMs = Date.now() - started;
    await agent[Symbol.asyncDispose]().catch(() => {});
  }
  return stats;
}

// ---------------------------------------------------------------- grading

function grade(task, ctx) {
  const { stats, changed, runState, verdict, checkRes, hiddenRes } = ctx;
  const g = [];
  const add = (name, pass, detail) => g.push({ name, pass, detail });
  const enabled = (k) => task.graders?.[k] !== false;

  add("agent_finished", stats.status === "finished", stats.status + (stats.error ? `: ${stats.error}` : ""));

  if (enabled("check_full")) {
    add("check_full", checkRes.skipped ? null : checkRes.code === 0, checkRes.skipped ? checkRes.out : `exit ${checkRes.code}`);
  }
  if (enabled("hidden_tests") && (task.hidden_commands ?? []).length) {
    const bad = hiddenRes.find((h) => h.code !== 0);
    add("hidden_tests", !bad, bad ? `failed: ${bad.command}` : `${hiddenRes.length} command(s) passed`);
  }

  const outside = (task.allowed_paths ?? []).length
    ? changed.filter((c) => !matchesAny(c.file, task.allowed_paths))
    : [];
  const deletedProtected = changed.filter((c) => c.status === "D" && matchesAny(c.file, task.protected_paths ?? []));
  const scopeBad = [...outside, ...deletedProtected];
  const noChange = changed.length === 0;
  add(
    "scope",
    !scopeBad.length && !noChange,
    noChange ? "no files changed" : scopeBad.length ? `out of scope: ${scopeBad.map((c) => c.file).join(", ")}` : `${changed.length} file(s) changed`,
  );

  const lane = runState?.lane ?? stats.text.match(/EVAL-RESULT\s+lane=(XS|S|M|L)/)?.[1] ?? null;
  if (enabled("lane_correct")) add("lane_correct", lane === task.expected_lane, `expected ${task.expected_lane}, got ${lane ?? "unknown"}`);

  const roles = [...stats.calls.values()];
  const judgeCalls = roles.filter((r) => r === "judge").length;
  const expectedJudge = task.expected_judge ?? (task.expected_lane === "XS" ? "none" : "full");
  if (expectedJudge === "none") {
    add("judge_policy", judgeCalls === 0, judgeCalls === 0 ? "judge skipped as expected" : `judge ran ${judgeCalls}x but expected none`);
  } else if (task.graders?.rubric_min != null) {
    const min = task.graders.rubric_min;
    if (!verdict) add("rubric", false, "judge expected but no .harness/verdict.json");
    else add("rubric", verdict.verdict !== "FAIL" && (verdict.score ?? 0) >= min, `${verdict.verdict ?? "?"} score ${verdict.score ?? "?"} (min ${min})`);
  }

  const missingRoles = (task.expected_roles ?? []).filter((r) => !roles.includes(r));
  if ((task.expected_roles ?? []).length) {
    add("routing", !missingRoles.length, missingRoles.length ? `role(s) never called: ${missingRoles.join(", ")}` : `called: ${[...new Set(roles)].join(", ")}`);
  }

  const calls = Math.max(stats.calls.size, runState?.calls ?? 0);
  const retries = Math.max(roles.filter((r) => r === "debugger").length, runState?.debugEntries ?? 0);
  const escalated = runState?.state === "escalate";
  const overCalls = calls > task.budget.max_calls;
  const overRetries = task.budget.max_retries != null && retries > task.budget.max_retries;
  if (enabled("within_budget")) {
    add("within_budget", !overCalls && !overRetries && !escalated, `calls ${calls}/${task.budget.max_calls}, retries ${retries}/${task.budget.max_retries ?? "-"}${escalated ? ", escalated" : ""}`);
  }

  const wallS = Math.round(stats.durationMs / 1000);
  const maxWall = task.budget.max_wall_seconds;
  g.push({ name: "wall_time", pass: null, informational: true, detail: `${wallS}s${maxWall ? ` (budget ${maxWall}s)` : ""}` });

  const pass = g.every((x) => x.pass !== false);
  return {
    pass,
    graders: g,
    metrics: { lane, calls, retries, rubric: verdict?.score ?? null, wallMs: stats.durationMs },
    budgetExceeded: overCalls || overRetries || escalated,
    roles,
  };
}

// ---------------------------------------------------------------- one task end to end

async function evalTask(sdk, task, ctx) {
  const stamp = `${ctx.stamp}-${Math.random().toString(36).slice(2, 6)}`;
  const base = resolveBase(task, ctx.baseOverride);
  const out = { id: task.id, base: { ref: base.ref, sha: base.sha, fallback: base.fallback }, expectedLane: task.expected_lane };
  let wtInfo;
  try {
    wtInfo = await createWorktree(task, base, stamp);
    out.worktree = ctx.keep ? wtInfo.wt : undefined;
    const stats = await runAgent(sdk, task, ctx, wtInfo.wt);

    // Snapshot the agent's work before the hidden files exist.
    const changed = listChangedFiles(wtInfo.wt, wtInfo.seedSha);
    for (const e of task.hidden_tests ?? []) copyEntry(e, wtInfo.wt);
    const checkRes = runCheckFull(wtInfo.wt);
    const hiddenRes = (task.hidden_commands ?? []).map((command) => ({ command, ...runCmd(command, wtInfo.wt) }));
    const runState = readRunState(wtInfo.wt);
    const verdict = readVerdict(wtInfo.wt);

    const graded = grade(task, { stats, changed, runState, verdict, checkRes, hiddenRes });
    Object.assign(out, graded, {
      status: stats.status,
      agentId: stats.agentId,
      runId: runState?.runId ?? stats.runId,
      changed,
      finalText: stats.finalText,
      checkOutput: checkRes.out,
      hiddenOutput: hiddenRes.map((h) => ({ command: h.command, code: h.code, out: h.out })),
      usage: stats.usage,
    });
  } catch (e) {
    out.pass = false;
    out.status = "error";
    out.error = e.message;
    out.graders = [{ name: "runner", pass: false, detail: e.message }];
    out.metrics = { lane: null, calls: null, retries: null, rubric: null, wallMs: null };
  } finally {
    if (wtInfo && !ctx.keep) await removeWorktree(wtInfo.wt, wtInfo.branch);
  }
  log(`[${task.id}] ${out.pass ? "PASS" : "FAIL"}`);
  return out;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------- baseline comparison

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
      notes.push(`${r.id}: no baseline yet (candidate baseline)`);
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
  const tasks = { ...(existing.tasks ?? {}) };
  for (const r of results) {
    tasks[r.id] = {
      pass: r.pass,
      lane: r.metrics.lane,
      calls: r.metrics.calls,
      retries: r.metrics.retries,
      rubric: r.metrics.rubric,
      wallMs: r.metrics.wallMs,
    };
  }
  const next = { ...existing, version: 1, recorded: new Date().toISOString(), ...meta, tasks };
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { ids: [], concurrency: DEFAULT_CONCURRENCY, model: process.env.FIORE_EVAL_MODEL || DEFAULT_MODEL };
  const val = (i, flag) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--concurrency") o.concurrency = Number(val(i++, a));
    else if (a === "--model") o.model = val(i++, a);
    else if (a === "--base") o.base = val(i++, a);
    else if (a === "--timeout") o.timeoutS = Number(val(i++, a));
    else if (a === "--keep") o.keep = true;
    else if (a === "--json") o.json = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--list") o.list = true;
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
  if (o.timeoutS != null && !(o.timeoutS > 0)) throw new UsageError("--timeout must be > 0 seconds");
  if (o.writeBaseline && !o.yes) {
    throw new UsageError("--write-baseline requires --yes (the baseline changes only after the user approves)");
  }
  return o;
}

function printSummary(results, cmp) {
  const pad = (s, n) => String(s).padEnd(n);
  const pass = results.filter((r) => r.pass).length;
  console.log(`Eval ${new Date().toISOString().slice(0, 10)}: ${results.length} tasks, ${pass} pass, ${results.length - pass} fail`);
  console.log(`${pad("task", 28)}${pad("lane(exp/act)", 15)}${pad("calls", 7)}${pad("rubric", 8)}result`);
  for (const r of results) {
    console.log(
      `${pad(r.id, 28)}${pad(`${r.expectedLane}/${r.metrics.lane ?? "?"}`, 15)}${pad(r.metrics.calls ?? "-", 7)}${pad(r.metrics.rubric ?? "-", 8)}${r.pass ? "PASS" : "FAIL"}`,
    );
    for (const g of r.graders.filter((x) => x.pass === false)) console.log(`    x ${g.name}: ${g.detail}`);
  }
  for (const n of cmp.notes) console.log(`note: ${n}`);
  console.log(`Regressions: ${cmp.regressions.length ? cmp.regressions.map((x) => `${x.task} ${x.metric} ${x.from}->${x.to}`).join("; ") : "none"}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node evals/run.mjs [<task-id> ...] [--concurrency n] [--model id] [--base ref] [--timeout s] [--keep] [--json] [--dry-run] [--list] [--write-baseline --yes]\nNeeds CURSOR_API_KEY in the environment (except --dry-run/--list).");
    return 0;
  }
  const tasks = loadTasks(opts.ids);

  if (opts.list || opts.dryRun) {
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
    if (opts.dryRun) log(`dry run ok: ${tasks.length} task(s) parsed and validated; nothing executed`);
    return 0;
  }

  if (!process.env.CURSOR_API_KEY) {
    throw new UsageError("CURSOR_API_KEY is not set in the environment (it is never read from a file)");
  }
  const dirty = tryGit(["status", "--porcelain", "--", ".cursor", "docs/harness", "scripts", "AGENTS.md"]);
  if (dirty) log("warn: uncommitted harness files are NOT present in eval worktrees (they are cut from a commit). Commit or tag first.");

  const sdk = await loadSdk();
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  log(`running ${tasks.length} task(s), concurrency ${opts.concurrency}, model ${opts.model}`);
  const results = await pool(tasks, opts.concurrency, (t) => evalTask(sdk, t, { ...opts, baseOverride: opts.base, stamp }));

  const baseline = loadBaseline();
  const cmp = compareToBaseline(baseline, results);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `${new Date().toISOString().slice(0, 10)}-${stamp.slice(8)}.json`);
  const meta = { sdk: "@cursor/sdk", model: opts.model, base: results[0]?.base?.sha ?? null };
  writeFileSync(outFile, `${JSON.stringify({ date: new Date().toISOString(), ...meta, results, comparison: cmp }, null, 2)}\n`);

  if (opts.writeBaseline) {
    writeBaseline(results, meta);
    log(`baseline written: ${BASELINE}`);
  }
  if (opts.json) console.log(JSON.stringify({ file: outFile, results, comparison: cmp }, null, 2));
  else {
    printSummary(results, cmp);
    console.log(`results: ${outFile}`);
  }

  const failed = results.some((r) => !r.pass) || cmp.regressions.length > 0;
  const onlyBudget = failed && results.filter((r) => !r.pass).every((r) => r.budgetExceeded && r.graders.filter((g) => g.pass === false).every((g) => g.name === "within_budget")) && cmp.regressions.length === 0;
  return failed ? (onlyBudget ? 3 : 1) : 0;
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

export { parseYaml, loadTasks, createWorktree, removeWorktree, listChangedFiles, grade, readRunState, copyEntry, runCmd, runCheckFull, globToRegExp };
