import type { Category } from '../../events';
import { type Animation, type Contribution, defineReaction, type Rng } from '../types';

const THINK_BODY: Animation = 'think';
const THINK_MS = 2_000;
const THINK_MIN_MS = 20_000;
const THINK_SPAN_MS = 20_000;

export interface ActivitySlice {
  category: Category;
  /** End of the current think pose. Null when the body stays on the engine pose. */
  thinkUntil: number | null;
  /** Start of the next think. Null when the category is not coding. */
  nextThinkAt: number | null;
}

export function initialActivity(category: Category): ActivitySlice {
  return { category, thinkUntil: null, nextThinkAt: null };
}

function thinkDelay(rng: Rng): number {
  return THINK_MIN_MS + Math.floor(rng.next() * (THINK_SPAN_MS + 1));
}

export function reduceActivity(
  slice: ActivitySlice,
  activity: Category,
  now: number,
  rng: Rng,
): ActivitySlice {
  if (activity !== 'coding') {
    if (slice.category === activity && slice.thinkUntil === null && slice.nextThinkAt === null) {
      return slice;
    }
    return { category: activity, thinkUntil: null, nextThinkAt: null };
  }

  const entered = slice.category !== 'coding' || slice.nextThinkAt === null;
  if (entered) {
    return { category: 'coding', thinkUntil: null, nextThinkAt: now + thinkDelay(rng) };
  }

  let thinkUntil = slice.thinkUntil;
  let nextThinkAt = slice.nextThinkAt;
  if (thinkUntil !== null && now >= thinkUntil) {
    thinkUntil = null;
  }
  if (thinkUntil === null && nextThinkAt !== null && now >= nextThinkAt) {
    if (now < nextThinkAt + THINK_MS) {
      const start = nextThinkAt;
      thinkUntil = start + THINK_MS;
      nextThinkAt = start + thinkDelay(rng);
    } else {
      // A tick that lands after the 2s window does not play a late think.
      // The frame loop ticks often; a jumped clock only schedules the next one.
      nextThinkAt = now + thinkDelay(rng);
    }
  }
  if (slice.thinkUntil === thinkUntil && slice.nextThinkAt === nextThinkAt) {
    return slice;
  }
  return { category: 'coding', thinkUntil, nextThinkAt };
}

export function activityContribution(slice: ActivitySlice, now: number): Contribution | null {
  if (slice.category !== 'coding' || slice.thinkUntil === null || now >= slice.thinkUntil) {
    return null;
  }
  return { tier: 'activity', body: THINK_BODY };
}

export const activityReaction = defineReaction<ActivitySlice>({
  id: 'activity',
  init(world) {
    return initialActivity(world.activity);
  },
  reduce(slice, _event, ctx) {
    return {
      slice: reduceActivity(slice, ctx.world.activity, ctx.now, ctx.rng),
      effects: [],
    };
  },
  tick(slice, ctx) {
    return {
      slice: reduceActivity(slice, ctx.world.activity, ctx.now, ctx.rng),
      effects: [],
    };
  },
  contribute(slice, ctx) {
    return activityContribution(slice, ctx.now);
  },
});
