import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../../events';
import { createEngine } from '../engine';
import type { ReactionContext, World } from '../types';
import { musicReaction } from './music';

const LEVEL_ALPHA = 0.3;

function world(playing: boolean): World {
  return {
    activity: 'other',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: playing
      ? { playing: true, title: 't', artist: 'a', sourceApp: 'app' }
      : { playing: false },
    peak: 0,
  };
}

function ctx(playing: boolean): ReactionContext {
  return {
    now: 0,
    rng: { next: () => 0 },
    world: world(playing),
    config: { rng: { next: () => 0 }, oneShotMs: {} },
  };
}

function level(peak: number): FioreEvent {
  return { type: 'music.level', payload: { peak } };
}

describe('music reaction', () => {
  it('smooths peaks while playing and resets on stop', () => {
    const playing = ctx(true);
    let slice = musicReaction.init(world(false));
    const ignored = musicReaction.reduce(slice, level(0.9), ctx(false));
    expect(ignored.effects).toEqual([]);
    expect(musicReaction.contribute(ignored.slice, ctx(false))).toBeNull();

    const first = musicReaction.reduce(ignored.slice, level(0.4), playing);
    expect(first.effects).toEqual([]);
    expect(musicReaction.contribute(first.slice, playing)).toEqual({
      tier: 'music',
      overlayLevel: LEVEL_ALPHA * 0.4,
    });

    const second = musicReaction.reduce(first.slice, level(0.8), playing);
    const firstLevel = LEVEL_ALPHA * 0.4;
    const secondLevel = firstLevel + LEVEL_ALPHA * (0.8 - firstLevel);
    expect(musicReaction.contribute(second.slice, playing)).toEqual({
      tier: 'music',
      overlayLevel: secondLevel,
    });
    expect(secondLevel).toBeGreaterThan(firstLevel);

    const started = musicReaction.reduce(
      second.slice,
      { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
      playing,
    );
    expect(started.effects).toEqual([]);
    const changed = musicReaction.reduce(
      started.slice,
      { type: 'music.track_changed', payload: { title: 'Song', artist: 'Ada' } },
      playing,
    );
    expect(changed.effects).toEqual([]);

    const stopped = musicReaction.reduce(
      changed.slice,
      { type: 'music.stopped', payload: {} },
      ctx(false),
    );
    expect(musicReaction.contribute(stopped.slice, ctx(false))).toBeNull();
    slice = stopped.slice;
    const restarted = musicReaction.reduce(slice, level(0.4), playing);
    expect(musicReaction.contribute(restarted.slice, playing)?.overlayLevel).toBe(
      LEVEL_ALPHA * 0.4,
    );
  });

  it('ignores levels while stopped and does not jump at peak 0.8', () => {
    const engine = createEngine({
      rng: { next: () => 0 },
      oneShotMs: { notice: 1000, jump: 600 },
    });
    const snapshot: FioreEvent = {
      type: 'state.snapshot',
      payload: {
        activity: 'other',
        mood: 'content',
        season: 'autumn',
        fullscreen: false,
        music: { playing: false },
      },
    };
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    const ignored = engine.handle({ kind: 'event', now: 1, event: level(1) });
    expect(ignored).toMatchObject({ body: 'idle', overlayLevel: 0, accessory: null });

    engine.handle({
      kind: 'event',
      now: 2,
      event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
    });
    const dancing = engine.handle({ kind: 'tick', now: 1002 });
    expect(dancing.body).toBe('dance');
    const held = engine.handle({ kind: 'event', now: 1100, event: level(0.8) });
    expect(held).toMatchObject({
      body: 'dance',
      accessory: 'headphones',
      overlay: null,
      overlayLevel: LEVEL_ALPHA * 0.8,
    });

    engine.handle({
      kind: 'event',
      now: 1200,
      event: { type: 'music.track_changed', payload: { title: 'Song', artist: 'Ada' } },
    });
    expect(engine.handle({ kind: 'tick', now: 4199 }).bubble).toBe('Song');
    expect(engine.handle({ kind: 'tick', now: 4200 }).bubble).toBeNull();
    expect(
      engine.handle({ kind: 'event', now: 4300, event: { type: 'music.stopped', payload: {} } }),
    ).toMatchObject({
      body: 'idle',
      accessory: null,
      overlay: null,
      overlayLevel: 0,
      bubble: null,
      move: 'wander',
    });
  });
});
