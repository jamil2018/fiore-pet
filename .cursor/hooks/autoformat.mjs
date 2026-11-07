// afterFileEdit hook: format the edited file mechanically so formatting never burns a debugger attempt.
// .rs -> rustfmt; ts/tsx/js/jsx/mjs/cjs/json/jsonc/css -> biome format (local install only, no network).
// Skips silently when the tool or its config is missing. Never fails the edit.
import fs from 'node:fs';
import path from 'node:path';
import { emit, hookLog, mainRoot, projectDir, readInput, run } from './lib.mjs';

const BIOME_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.css']);
const SKIP_SEGMENTS = new Set(['node_modules', 'target', 'dist', '.harness', 'logs', '.cursor', 'docs', 'gen', '.git']);
const SKIP_FILES = new Set(['package-lock.json']);

function main(input) {
  const raw = input.file_path;
  if (!raw) return;
  const root = projectDir(input);
  const file = path.resolve(raw.replace(/^\/([a-zA-Z]:)/, '$1'));
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file)) return;
  const segs = rel.split('/');
  if (segs.some((s) => SKIP_SEGMENTS.has(s)) || SKIP_FILES.has(segs.at(-1))) return;
  if (rel.startsWith('public/sprites/')) return;

  const ext = path.extname(file).toLowerCase();
  if (ext === '.rs') {
    const r = run('rustfmt', ['--edition', '2021', file], { cwd: root, timeout: 20000 });
    if (r.error?.code === 'ENOENT') return;
    if (r.status !== 0) hookLog(mainRoot(root), 'autoformat', `rustfmt failed for ${rel}: ${r.stderr.slice(0, 300)}`);
    return;
  }
  if (BIOME_EXT.has(ext)) {
    if (!fs.existsSync(path.join(root, 'biome.json')) && !fs.existsSync(path.join(root, 'biome.jsonc'))) return;
    const bin = [root, mainRoot(root)]
      .map((r) => path.join(r, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'))
      .find((p) => fs.existsSync(p));
    if (!bin) return;
    const r = run(process.execPath, [bin, 'format', '--write', '--no-errors-on-unmatched', '--files-ignore-unknown=true', file], { cwd: root, timeout: 20000 });
    if (r.status !== 0) hookLog(mainRoot(root), 'autoformat', `biome failed for ${rel}: ${(r.stderr || r.stdout).slice(0, 300)}`);
  }
}

readInput()
  .then((input) => {
    try {
      main(input);
    } catch (err) {
      hookLog(mainRoot(projectDir(input)), 'autoformat', `internal error: ${err?.message}`);
    }
  })
  .finally(() => emit({}));
