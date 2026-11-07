import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../../events';
import type { ReactionContext, World } from '../types';
import { moodReaction } from './mood';

function world(mood: World['mood']): World {
  return {
    activity: 'coding',
    mood,
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
    world: world('energetic'),
    config: { rng: { next: () => 0 }, oneShotMs: {} },
  };
}

describe('mood reaction', () => {
  it('stays empty so the engine keeps stretch, yawn, face, and speed', () => {
    const slice = moodReaction.init(world('content'));
    const context = ctx();
    const events: FioreEvent[] = [
      { type: 'time.mood_changed', payload: { mood: 'energetic' } },
      { type: 'time.mood_changed', payload: { mood: 'sleepy' } },
      { type: 'season.changed', payload: { season: 'winter' } },
    ];
    expect(moodReaction.id).toBe('mood');
    for (const event of events) {
      expect(moodReaction.reduce(slice, event, context).effects).toEqual([]);
    }
    expect(moodReaction.tick(slice, context).effects).toEqual([]);
    expect(moodReaction.contribute(slice, context)).toBeNull();
  });
});
