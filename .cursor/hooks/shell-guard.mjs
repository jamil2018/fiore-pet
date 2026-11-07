// beforeShellExecution hook: deny-list for destructive or policy-violating commands.
// Denies: force pushes, pushes from task/* to main, `git reset --hard`, recursive deletes outside
// target/ and node_modules/, registry edits. Commands are tokenized (quote-aware) so text inside
// commit messages or echo arguments does not trigger a deny. Internal errors fail open.
import path from 'node:path';
import { currentBranch, emit, hookLog, mainRoot, projectDir, readInput } from './lib.mjs';

const WRAPPERS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe']);
const DELETE_CMDS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
const REGISTRY_CMDLETS = new Set([
  'set-itemproperty', 'new-itemproperty', 'remove-itemproperty', 'rename-itemproperty', 'copy-itemproperty', 'move-itemproperty',
  'new-item', 'set-item', 'remove-item', 'sp', 'ni', 'ri', 'rp', 'rnp', 'cpp', 'mp',
]);
const HIVE_RE = /\b(hk(?:lm|cu|cr|u|cc)\w*:|registry::|hkey_[a-z_]+)/i;
const SAFE_DELETE_DIRS = new Set(['target', 'node_modules']);

function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (const c of cmd) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '\n' || c === '\r' || c === '|' || c === '&') {
      segs.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function tokenize(seg) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const c of seg) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

const exeName = (t) => path.basename(t.replace(/\\/g, '/')).toLowerCase();

function stripPrefixes(tokens) {
  const t = [...tokens];
  while (t.length && (/^\w+=/.test(t[0]) || t[0] === '&' || t[0] === '.' || ['sudo', 'command', 'call'].includes(t[0].toLowerCase()))) t.shift();
  return t;
}

function normRef(ref) {
  return ref.replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

function checkGit(tokens, cwd) {
  let i = 1;
  let gitCwd = cwd;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const t = tokens[i];
    if (t === '-C' && tokens[i + 1]) {
      gitCwd = path.resolve(cwd, tokens[i + 1]);
      i += 2;
    } else if ((t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') && tokens[i + 1]) {
      i += 2;
    } else {
      i += 1;
    }
  }
  const sub = (tokens[i] ?? '').toLowerCase();
  const rest = tokens.slice(i + 1);
  const flags = rest.filter((t) => t.startsWith('-'));
  const pos = rest.filter((t) => !t.startsWith('-'));

  if (sub === 'reset' && flags.includes('--hard')) {
    return 'git reset --hard discards uncommitted work. Use `git stash` or ask the user to run it.';
  }
  if (sub !== 'push') return null;

  const forced =
    flags.some((f) => f === '--force' || f === '-f' || f === '--mirror' || f === '--force-if-includes' || f.startsWith('--force-with-lease')) ||
    flags.some((f) => /^-[a-zA-Z]+$/.test(f) && f.includes('f')) ||
    pos.slice(1).some((p) => p.startsWith('+'));
  if (forced) return 'Force pushes are blocked (public repo). Ask the user to run it manually if it is truly needed.';

  const branch = currentBranch(gitCwd);
  const refspecs = pos.slice(1);
  for (const spec of refspecs) {
    const [srcRaw, dstRaw] = spec.includes(':') ? spec.split(':') : [spec, spec];
    const src = normRef(srcRaw === 'HEAD' ? branch : srcRaw);
    const dst = normRef(dstRaw === 'HEAD' ? branch : dstRaw);
    if (dst === 'main' && (branch.startsWith('task/') || src.startsWith('task/'))) {
      return 'Pushing a task/* branch to main is blocked. Integrate through /integrate (judge PASS + checkpoint commit on main).';
    }
  }
  return null;
}

function isRecursive(t) {
  return /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) || /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(t) || t === '--recursive' || /^\/s$/i.test(t);
}

function safeDeleteTarget(raw, projectRoot) {
  let t = raw.replace(/\\/g, '/');
  if (/[$%`]/.test(t)) return false;
  if (t.includes('..') || t === '~' || t.startsWith('~/')) return false;
  if (/^([a-zA-Z]:)?\/$/.test(t)) return false;
  if (/^([a-zA-Z]:)?\//.test(t)) {
    const rel = path.relative(projectRoot.replace(/\\/g, '/'), t);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    t = rel.replace(/\\/g, '/');
  }
  t = t.replace(/^\.\//, '').replace(/\/+$/, '');
  return t.split('/').some((seg) => SAFE_DELETE_DIRS.has(seg));
}

function checkDelete(tokens, projectRoot) {
  const args = tokens.slice(1);
  if (!args.some(isRecursive)) return null;
  const targets = args.filter((a) => !a.startsWith('-') && !/^\/[a-zA-Z]$/.test(a));
  const bad = targets.filter((t) => !safeDeleteTarget(t, projectRoot));
  if (!bad.length) return null;
  return `Recursive delete is only allowed inside target/ or node_modules/ (blocked: ${bad.join(', ')}). Use \`git worktree remove\` for worktrees, or ask the user.`;
}

function checkRegistry(tokens) {
  const exe = exeName(tokens[0]);
  if (exe === 'regedit' || exe === 'regedit.exe') return true;
  if (exe === 'reg' || exe === 'reg.exe') {
    return /^(add|delete|import|load|unload|copy|restore|save|flags)$/i.test(tokens[1] ?? '');
  }
  if (REGISTRY_CMDLETS.has(exe) && tokens.slice(1).some((t) => HIVE_RE.test(t))) return true;
  return tokens.some((t) => /Microsoft\.Win32\.Registry/i.test(t));
}

function analyze(command, ctx, depth = 0) {
  for (const seg of splitSegments(command)) {
    const tokens = stripPrefixes(tokenize(seg));
    if (!tokens.length) continue;
    const exe = exeName(tokens[0]).replace(/\.exe$/, '');

    if (exe === 'git') {
      const reason = checkGit(tokens, ctx.cwd);
      if (reason) return reason;
    }
    if (DELETE_CMDS.has(exe)) {
      const reason = checkDelete(tokens, ctx.root);
      if (reason) return reason;
    }
    if (checkRegistry(tokens)) {
      return 'Registry edits are blocked. Ask the user to apply them manually (autostart is handled by the Tauri plugin, not by shell).';
    }
    if (depth < 3 && WRAPPERS.has(exeName(tokens[0]))) {
      const idx = tokens.findIndex((t, k) => k > 0 && /^(-c|-command|-lc|\/c|\/k|-encodedcommand)$/i.test(t));
      if (idx !== -1) {
        const reason = analyze(tokens.slice(idx + 1).join(' '), ctx, depth + 1);
        if (reason) return reason;
      }
    }
  }
  return null;
}

async function main() {
  const input = await readInput();
  const command = String(input.command ?? '');
  const root = projectDir(input);
  const cwd = input.cwd ? path.resolve(input.cwd) : root;
  let reason = null;
  try {
    reason = analyze(command, { cwd, root });
  } catch (err) {
    hookLog(mainRoot(root), 'shell-guard', `internal error, allowing: ${err?.message}`);
  }
  if (reason) {
    hookLog(mainRoot(root), 'shell-guard', `DENY: ${command.slice(0, 200)} :: ${reason}`);
    emit({
      permission: 'deny',
      user_message: `Blocked by Fiore shell deny-list: ${reason}`,
      agent_message: `This command was blocked by .cursor/hooks/shell-guard.mjs. ${reason} Do not retry it; report to the user if it is required.`,
    });
  } else {
    emit({ permission: 'allow' });
  }
}

main().catch(() => emit({ permission: 'allow' }));
