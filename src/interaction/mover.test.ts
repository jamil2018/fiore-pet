import { describe, expect, it } from 'vitest';

import type { Resolution } from '../behavior/types';
import type { Bridge } from '../bridge';
import { advanceWander, clampPoint, createMover, type Point } from './mover';

const area = { x: 0, y: 0, width: 1000, height: 800 };
const windowSize = { width: 10, height: 10 };

function resolution(move: Resolution['move']): Resolution {
  return {
    body: null,
    face: null,
    outfit: null,
    accessory: null,
    overlay: null,
    speed: 1,
    bubble: null,
    visible: true,
    move,
  };
}

function bridge(onSet: (x: number, y: number) => void): Bridge {
  return {
    kind: 'mock',
    async subscribe() {
      return () => {};
    },
    async ready() {},
    async emitDebug() {},
    window: {
      async show() {},
      async hide() {},
      async setPosition(x, y) {
        onSet(x, y);
      },
    },
  };
}

function queuedSchedule() {
  const queue: Array<() => void> = [];
  return {
    queue,
    schedule(callback: () => void) {
      queue.push(callback);
      return () => {
        const index = queue.indexOf(callback);
        if (index >= 0) queue.splice(index, 1);
      };
    },
  };
}

async function pump(queue: Array<() => void>): Promise<void> {
  const next = queue.shift();
  expect(next).toBeTypeOf('function');
  next?.();
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('advanceWander', () => {
  it('steps toward the target without replacing it', () => {
    const next = advanceWander(
      { position: { x: 0, y: 0 }, target: { x: 30, y: 40 } },
      { area, windowSize, stepPx: 5, rng: () => 0 },
    );
    expect(next.position).toEqual({ x: 3, y: 4 });
    expect(next.target).toEqual({ x: 30, y: 40 });
  });

  it('picks a new target once the pet has arrived', () => {
    const next = advanceWander(
      { position: { x: 30, y: 40 }, target: { x: 30, y: 40 } },
      { area, windowSize, stepPx: 5, rng: () => 0 },
    );
    expect(next.target).toEqual({ x: 0, y: 0 });
    expect(next.position).not.toEqual({ x: 30, y: 40 });
  });

  it('keeps every step inside the work area as integers', () => {
    let state: { position: Point; target: Point | null } = {
      position: { x: 0, y: 0 },
      target: null,
    };
    for (let i = 0; i < 40; i += 1) {
      state = advanceWander(state, { area, windowSize, stepPx: 50, rng: () => 1 });
      expect(Number.isInteger(state.position.x)).toBe(true);
      expect(Number.isInteger(state.position.y)).toBe(true);
      expect(state.position.x).toBeGreaterThanOrEqual(area.x);
      expect(state.position.y).toBeGreaterThanOrEqual(area.y);
      expect(state.position.x).toBeLessThanOrEqual(area.x + area.width - windowSize.width);
      expect(state.position.y).toBeLessThanOrEqual(area.y + area.height - windowSize.height);
    }
  });

  it('clamps a point that starts outside the work area', () => {
    expect(clampPoint({ x: -20, y: 5000 }, area, windowSize)).toEqual({ x: 0, y: 790 });
  });
});

describe('WindowMover', () => {
  it('stay does not move and cancels a pending wander', async () => {
    const calls: Array<[number, number]> = [];
    const timer = queuedSchedule();
    const mover = createMover(
      bridge((x, y) => calls.push([x, y])),
      {
        rng: () => 1,
        schedule: timer.schedule,
        stepPx: 5,
        windowSize,
        workArea: async () => area,
        position: async () => ({ x: 0, y: 0 }),
      },
    );

    mover.apply(resolution('stay'));
    expect(timer.queue).toHaveLength(0);

    mover.apply(resolution('wander'));
    mover.apply(resolution('wander'));
    expect(timer.queue).toHaveLength(1);

    mover.apply(resolution('stay'));
    expect(timer.queue).toHaveLength(0);
    await pumpEmpty();
    expect(calls).toEqual([]);
  });

  it('wander calls setPosition and keeps walking until stay', async () => {
    const calls: Array<[number, number]> = [];
    const timer = queuedSchedule();
    const mover = createMover(
      bridge((x, y) => calls.push([x, y])),
      {
        rng: () => 1,
        schedule: timer.schedule,
        stepPx: 5,
        windowSize,
        workArea: async () => area,
        position: async () => ({ x: 0, y: 0 }),
      },
    );

    mover.apply(resolution('wander'));
    await pump(timer.queue);
    await pump(timer.queue);
    expect(calls).toEqual([
      [4, 3],
      [8, 6],
    ]);

    mover.apply(resolution('stay'));
    expect(timer.queue).toHaveLength(0);
    const settled = calls.length;
    await pumpEmpty();
    expect(calls).toHaveLength(settled);
  });
});

async function pumpEmpty(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
