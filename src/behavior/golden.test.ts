import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type FioreEvent, parseFioreEvent, type Snapshot } from '../events';
import { createEngine } from './engine';
import type { Resolution, Rng } from './types';

const ONE_SHOT_MS = {
  notice: 1000,
  jump: 1000,
  stretch: 1000,
  yawn: 1000,
  twirl: 1000,
  appear: 1000,
  hide: 1000,
  wag: 800,
} as const;

const EXPECT_KEYS = [
  'body',
  'face',
  'outfit',
  'accessory',
  'overlay',
  'overlayLevel',
  'speed',
  'bubble',
  'visible',
  'move',
  'facing',
] as const;

type ExpectKey = (typeof EXPECT_KEYS)[number];
type GoldenExpect = Partial<Pick<Resolution, ExpectKey>>;

interface GoldenStep {
  at: number;
  tick?: boolean;
  event?: FioreEvent;
  expect: GoldenExpect;
}

interface GoldenCase {
  name: string;
  start: { now: number; seed: number; snapshot: Snapshot };
  steps: GoldenStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function parseExpect(value: unknown, label: string): GoldenExpect {
  if (!isRecord(value)) throw new Error(`${label}: expect must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`${label}: unknown expect field ${key}`);
    }
  }
  const expectPart: GoldenExpect = {};
  if (value.body !== undefined) expectPart.body = value.body as Resolution['body'];
  if (value.face !== undefined) expectPart.face = value.face as Resolution['face'];
  if (value.outfit !== undefined) expectPart.outfit = value.outfit as Resolution['outfit'];
  if (value.accessory !== undefined) {
    expectPart.accessory = value.accessory as Resolution['accessory'];
  }
  if (value.overlay !== undefined) expectPart.overlay = value.overlay as Resolution['overlay'];
  if (value.overlayLevel !== undefined) {
    expectPart.overlayLevel = value.overlayLevel as Resolution['overlayLevel'];
  }
  if (value.speed !== undefined) expectPart.speed = value.speed as Resolution['speed'];
  if (value.bubble !== undefined) expectPart.bubble = value.bubble as Resolution['bubble'];
  if (value.visible !== undefined) expectPart.visible = value.visible as Resolution['visible'];
  if (value.move !== undefined) expectPart.move = value.move as Resolution['move'];
  if (value.facing !== undefined) expectPart.facing = value.facing as Resolution['facing'];
  return expectPart;
}

function parseCase(raw: unknown, label: string): GoldenCase {
  if (
    !isRecord(raw) ||
    typeof raw.name !== 'string' ||
    !isRecord(raw.start) ||
    !Array.isArray(raw.steps)
  ) {
    throw new Error(`${label}: malformed golden case`);
  }
  if (typeof raw.start.now !== 'number' || typeof raw.start.seed !== 'number') {
    throw new Error(`${label}: start.now and start.seed are required`);
  }
  const snapshot = parseFioreEvent({ type: 'state.snapshot', payload: raw.start.snapshot });
  if (snapshot?.type !== 'state.snapshot') throw new Error(`${label}: bad snapshot`);
  const steps: GoldenStep[] = raw.steps.map((step, index) => {
    const stepLabel = `${label} step ${index}`;
    if (!isRecord(step) || typeof step.at !== 'number') throw new Error(`${stepLabel}: missing at`);
    const hasEvent = step.event !== undefined;
    const ticked = step.tick === true;
    if (hasEvent === ticked) throw new Error(`${stepLabel}: set exactly one of event or tick`);
    let event: FioreEvent | undefined;
    if (hasEvent) {
      const parsed = parseFioreEvent(step.event);
      if (!parsed) throw new Error(`${stepLabel}: bad event`);
      event = parsed;
    }
    return { at: step.at, tick: ticked, event, expect: parseExpect(step.expect, stepLabel) };
  });
  return {
    name: raw.name,
    start: { now: raw.start.now, seed: raw.start.seed, snapshot: snapshot.payload },
    steps,
  };
}

function assertFields(actual: Resolution, expected: GoldenExpect): void {
  for (const key of EXPECT_KEYS) {
    if (expected[key] !== undefined) expect(actual[key]).toEqual(expected[key]);
  }
}

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const files = readdirSync(goldenDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

describe('golden replay', () => {
  it('loads sequence files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const golden = parseCase(
      JSON.parse(readFileSync(join(goldenDir, file), 'utf8')) as unknown,
      file,
    );
    it(golden.name, () => {
      const engine = createEngine({
        rng: mulberry32(golden.start.seed),
        oneShotMs: { ...ONE_SHOT_MS },
      });
      engine.handle({
        kind: 'event',
        now: golden.start.now,
        event: { type: 'state.snapshot', payload: golden.start.snapshot },
      });
      for (const step of golden.steps) {
        const resolution = step.event
          ? engine.handle({ kind: 'event', event: step.event, now: step.at })
          : engine.handle({ kind: 'tick', now: step.at });
        assertFields(resolution, step.expect);
      }
    });
  }
});
