#!/usr/bin/env node
// Injects one FioreEvent into the dev app. Protocol: debug.rs loopback TCP,
// one JSON object per line, {"type","payload"}.

import { realpathSync, readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 17321;

const USAGE = `usage: node scripts/dev/emit-event.mjs <event> [payload-json]
       node scripts/dev/emit-event.mjs --format <event> [payload-json]

Sends one newline-terminated FioreEvent to ${HOST}:$FIORE_DEV_PORT (default ${DEFAULT_PORT}).
When payload-json is omitted, the golden fixture for <event> is used.`;

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function catalogTypes(root = repoRoot()) {
  const dir = join(root, 'src', 'behavior', 'golden', 'events');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

export function defaultPayload(type, root = repoRoot()) {
  const file = join(root, 'src', 'behavior', 'golden', 'events', `${type}.json`);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`fixture ${type} is not an object`);
  }
  const payload = parsed.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`fixture ${type} has no object payload`);
  }
  return payload;
}

export function formatEventLine(type, payload) {
  return `${JSON.stringify({ type, payload })}\n`;
}

export function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) return new Error('FIORE_DEV_PORT must be an integer');
  const port = Number(raw);
  if (port < 1 || port > 65535) return new Error('FIORE_DEV_PORT must be 1-65535');
  return port;
}

export function parseArgs(argv, env = process.env, root = repoRoot()) {
  let formatOnly = false;
  const rest = [];
  for (const arg of argv) {
    if (arg === '--format') formatOnly = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else rest.push(arg);
  }
  if (rest.length < 1 || rest.length > 2) {
    return { error: 'expected <event> [payload-json]' };
  }
  const type = rest[0];
  const known = catalogTypes(root);
  if (!known.includes(type)) {
    return { error: `unknown event "${type}"` };
  }
  let payload;
  if (rest[1] === undefined) {
    payload = defaultPayload(type, root);
  } else {
    try {
      payload = JSON.parse(rest[1]);
    } catch {
      return { error: 'payload is not valid JSON' };
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { error: 'payload must be a JSON object' };
    }
  }
  const port = parsePort(env.FIORE_DEV_PORT);
  if (port instanceof Error) return { error: port.message };
  return { type, payload, port, formatOnly };
}

export function sendLine(port, line, { host = HOST, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => {
      fail(new Error(`timed out connecting to ${host}:${port}`));
    }, timeoutMs);
    socket.on('error', (err) => {
      if (err && err.code === 'ECONNREFUSED') {
        fail(new Error(`could not connect to ${host}:${port} (is npm run tauri dev running?)`));
        return;
      }
      fail(err);
    });
    socket.on('connect', () => {
      socket.end(line, 'utf8', (err) => {
        if (err) fail(err);
      });
    });
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const line = formatEventLine(parsed.type, parsed.payload);
  if (parsed.formatOnly) {
    process.stdout.write(line);
    return;
  }
  try {
    await sendLine(parsed.port, line);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(line);
}

if (isDirectRun()) {
  main();
}
