import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../events';
import { createMockBridge, mockWindowCalls } from './mock';

const script = fileURLToPath(new URL('../../scripts/dev/emit-event.mjs', import.meta.url));

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

describe('createMockBridge', () => {
  it('emits the baseline snapshot then the script on ready', async () => {
    const seen: FioreEvent[] = [];
    const bridge = createMockBridge({
      script: [
        { type: 'music.stopped', payload: {} },
        { type: 'music.level', payload: { peak: 'nope' } },
      ],
    });
    await bridge.subscribe((event) => {
      seen.push(event);
    });
    await bridge.ready();
    await bridge.ready();
    expect(seen.map((event) => event.type)).toEqual(['state.snapshot', 'music.stopped']);
    const snapshot = seen[0];
    expect(snapshot).toEqual({
      type: 'state.snapshot',
      payload: {
        activity: 'other',
        mood: 'content',
        season: 'autumn',
        fullscreen: false,
        music: { playing: false },
      },
    });
  });

  it('delivers a script queued before subscribe', async () => {
    const bridge = createMockBridge({
      snapshot: false,
      script: [{ type: 'pet.petted', payload: {} }],
    });
    await bridge.ready();
    const seen: string[] = [];
    await bridge.subscribe((event) => {
      seen.push(event.type);
    });
    expect(seen).toEqual(['pet.petted']);
  });

  it('emitDebug reaches subscribers and queues until one exists', async () => {
    const bridge = createMockBridge({ snapshot: false });
    await bridge.emitDebug({ type: 'fullscreen.entered', payload: {} });
    const seen: string[] = [];
    const stop = await bridge.subscribe((event) => {
      seen.push(event.type);
    });
    expect(seen).toEqual(['fullscreen.entered']);
    stop();
    await bridge.emitDebug({ type: 'pet.petted', payload: {} });
    expect(seen).toEqual(['fullscreen.entered']);
    await bridge.subscribe((event) => {
      seen.push(event.type);
    });
    expect(seen).toEqual(['fullscreen.entered', 'pet.petted']);
  });

  it('records window calls', async () => {
    const bridge = createMockBridge();
    await bridge.window.show();
    await bridge.window.setPosition(3, 4);
    await bridge.window.hide();
    expect(mockWindowCalls(bridge)).toEqual([
      { op: 'show' },
      { op: 'setPosition', x: 3, y: 4 },
      { op: 'hide' },
    ]);
  });
});

describe('emit-event', () => {
  it('prints a fixture line without connecting', async () => {
    const result = await run(['--format', 'music.stopped'], process.env);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"type":"music.stopped","payload":{}}\n');
  });

  it('uses an explicit payload', async () => {
    const result = await run(['--format', 'music.level', '{"peak":0.25}'], process.env);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"type":"music.level","payload":{"peak":0.25}}\n');
  });

  it('rejects usage mistakes', async () => {
    expect((await run([], process.env)).status).toBe(2);
    expect((await run(['nope'], process.env)).status).toBe(2);
    expect((await run(['music.level', 'nope'], process.env)).status).toBe(2);
    expect((await run(['music.level', '[]'], process.env)).status).toBe(2);
    const port = await run(['music.stopped'], { ...process.env, FIORE_DEV_PORT: 'nope' });
    expect(port.status).toBe(2);
    expect(port.stderr).toContain('FIORE_DEV_PORT');
  });

  it('writes one json line to the loopback injector', async () => {
    const line = await new Promise<string>((resolve, reject) => {
      const server = net.createServer((socket) => {
        let data = '';
        socket.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
          if (data.includes('\n')) socket.end();
        });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('no port'));
          return;
        }
        void run(['music.started'], { ...process.env, FIORE_DEV_PORT: String(addr.port) }).then(
          (result) => {
            server.close();
            if (result.status !== 0) reject(new Error(result.stderr || result.stdout));
          },
          reject,
        );
      });
    });
    expect(line).toBe(
      '{"type":"music.started","payload":{"title":"Song","artist":"Artist","sourceApp":"Spotify.exe"}}\n',
    );
  });

  it('fails when the dev app is not listening', async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('no port'));
          return;
        }
        server.close(() => resolve(addr.port));
      });
    });
    const result = await run(['music.stopped'], {
      ...process.env,
      FIORE_DEV_PORT: String(port),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not connect');
  });
});
