import { describe, expect, it } from 'vitest';

import type { Category, FioreEvent } from '../../events';
import type { ReactionContext, Rng, World } from '../types';
import {
  type ActivitySlice,
  activityContribution,
  activityReaction,
  initialActivity,
  reduceActivity,
} from './activity';

const baseWorld: World = {
  activity: 'other',
  mood: 'content',
  season: 'autumn',
  fullscreen: false,
  music: { playing: false },
  peak: 0,
};

function countingRng(roll: number): { rng: Rng; draws: () => number } {
  let count = 0;
  return {
    rng: {
      next() {
        count += 1;
        return roll;
      },
    },
    draws: () => count,
  };
}

function ctx(now: number, activity: Category, rng: Rng): ReactionContext {
  return { now, rng, world: { ...baseWorld, activity }, config: { rng, oneShotMs: {} } };
}

const codingEvent: FioreEvent = {
  type: 'app.category_changed',
  payload: { category: 'coding', process: 'Code.exe', title: 'main' },
};

describe('activity think', () => {
  it('thinks for 2s on a 20s to 40s cadence and draws rng only when scheduling', () => {
    const { rng, draws } = countingRng(0);
    let slice = reduceActivity(initialActivity('other'), 'coding', 0, rng);
    expect(slice.nextThinkAt).toBe(20_000);
    expect(draws()).toBe(1);

    slice = reduceActivity(slice, 'coding', 1_000, rng);
    expect(activityContribution(slice, 1_000)).toBeNull();
    expect(draws()).toBe(1);

    slice = reduceActivity(slice, 'coding', 19_999, rng);
    expect(activityContribution(slice, 19_999)).toBeNull();

    slice = reduceActivity(slice, 'coding', 20_000, rng);
    expect(activityContribution(slice, 20_000)).toEqual({ tier: 'activity', body: 'think' });
    expect(activityContribution(slice, 21_999)).toEqual({ tier: 'activity', body: 'think' });
    expect(draws()).toBe(2);
    expect(slice.nextThinkAt).toBe(40_000);

    slice = reduceActivity(slice, 'coding', 22_000, rng);
    expect(activityContribution(slice, 22_000)).toBeNull();
    expect(draws()).toBe(2);
  });

  it('schedules the upper bound of the 20s to 40s interval', () => {
    const { rng } = countingRng(0.999999999);
    const slice = reduceActivity(initialActivity('other'), 'coding', 0, rng);
    expect(slice.nextThinkAt).toBe(40_000);
  });

  it('resets the schedule when the category changes', () => {
    const { rng, draws } = countingRng(0);
    let slice = reduceActivity(initialActivity('other'), 'coding', 0, rng);
    slice = reduceActivity(slice, 'coding', 20_000, rng);
    expect(activityContribution(slice, 21_000)?.body).toBe('think');

    slice = reduceActivity(slice, 'writing', 21_000, rng);
    expect(slice).toEqual({ category: 'writing', thinkUntil: null, nextThinkAt: null });
    expect(activityContribution(slice, 21_000)).toBeNull();
    expect(draws()).toBe(2);

    slice = reduceActivity(slice, 'coding', 21_000, rng);
    expect(slice.nextThinkAt).toBe(41_000);
    expect(activityContribution(slice, 21_000)).toBeNull();
    expect(draws()).toBe(3);
  });

  it('skips a think whose 2s window already ended', () => {
    const { rng, draws } = countingRng(0);
    let slice = reduceActivity(initialActivity('coding'), 'coding', 0, rng);
    slice = reduceActivity(slice, 'coding', 50_000, rng);
    expect(activityContribution(slice, 50_000)).toBeNull();
    expect(slice.nextThinkAt).toBe(70_000);
    expect(draws()).toBe(2);
  });

  it('wires the reaction without drawing rng from contribute', () => {
    const { rng, draws } = countingRng(0);
    let slice: ActivitySlice = activityReaction.init(baseWorld) as ActivitySlice;
    const reduced = activityReaction.reduce(slice, codingEvent, ctx(0, 'coding', rng));
    slice = reduced.slice as ActivitySlice;
    expect(reduced.effects).toEqual([]);
    expect(activityReaction.contribute(slice, ctx(0, 'coding', rng))).toBeNull();

    const ticked = activityReaction.tick(slice, ctx(20_000, 'coding', rng));
    expect(activityReaction.contribute(ticked.slice, ctx(20_000, 'coding', rng))).toEqual({
      tier: 'activity',
      body: 'think',
    });
    expect(draws()).toBe(2);
  });
});
