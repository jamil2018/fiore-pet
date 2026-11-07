import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../../events';
import type { ReactionContext, World } from '../types';
import { seasonReaction } from './season';

function world(): World {
  return {
    activity: 'coding',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: { playing: false },
    peak: 0,
  };
}

function ctx(): ReactionContext {
  return {
    now: 0,
    rng: { next: () => 0 },
    world: world(),
    config: { rng: { next: () => 0 }, oneShotMs: {} },
  };
}

describe('season reaction', () => {
  it('stays empty so the engine keeps twirl and the outfit', () => {
    const slice = seasonReaction.init(world());
    const context = ctx();
    const events: FioreEvent[] = [
      {
        type: 'state.snapshot',
        payload: {
          activity: 'coding',
          mood: 'content',
          season: 'autumn',
          fullscreen: false,
          music: { playing: false },
        },
      },
      { type: 'season.changed', payload: { season: 'winter' } },
      { type: 'season.changed', payload: { season: 'summer' } },
      {
        type: 'app.category_changed',
        payload: { category: 'other', process: 'explorer.exe', title: 'desktop' },
      },
    ];
    expect(seasonReaction.id).toBe('season');
    for (const event of events) {
      expect(seasonReaction.reduce(slice, event, context).effects).toEqual([]);
    }
    expect(seasonReaction.tick(slice, context).effects).toEqual([]);
    expect(seasonReaction.contribute(slice, context)).toBeNull();
  });
});
