import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../events';
import { createEngine } from './engine';
import { REACTIONS } from './reactions';
import { defineReaction, type EngineConfig, type OneShot, type Rng } from './types';

const ONE_SHOT_MS = {
  notice: 1000,
  jump: 1000,
  stretch: 1000,
  yawn: 1000,
  twirl: 1000,
  appear: 1000,
  hide: 1000,
  wag: 1000,
} as const satisfies Record<OneShot, number>;

function scripted(onNext?: () => number): Rng {
  return { next: () => onNext?.() ?? 1 };
}

function config(rng: Rng = scripted()): EngineConfig {
  return { rng, oneShotMs: { ...ONE_SHOT_MS } };
}

const snapshot = {
  type: 'state.snapshot',
  payload: {
    activity: 'other',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: { playing: false },
  },
} as const satisfies FioreEvent;

describe('createEngine', () => {
  it('ac_win_1_keeps_placement_static_across_activity_music_and_time', () => {
    const engine = createEngine(config());
    for (const activity of ['other', 'coding', 'writing', 'browsing'] as const) {
      for (const playing of [false, true]) {
        expect(
          engine.handle({
            kind: 'event',
            now: 0,
            event: {
              ...snapshot,
              payload: { ...snapshot.payload, activity, music: { playing } },
            },
          }).move,
        ).toBe('stay');
        for (const now of [400, 1000, 30_000, 300_000]) {
          expect(engine.handle({ kind: 'tick', now }).move).toBe('stay');
        }
      }
    }
  });
  it('idles in place before any event', () => {
    const engine = createEngine(config());
    expect(engine.handle({ kind: 'tick', now: 0 })).toMatchObject({
      body: 'idle',
      face: 'content',
      outfit: 'autumn',
      accessory: null,
      overlay: null,
      speed: 1,
      bubble: null,
      visible: true,
      move: 'stay',
      facing: 'right',
      overlayLevel: 0,
    });
  });

  it('ac_sn_1_fullscreen_snapshot_is_hidden_without_hide', () => {
    const engine = createEngine(config());
    const resolution = engine.handle({
      kind: 'event',
      now: 0,
      event: {
        type: 'state.snapshot',
        payload: { ...snapshot.payload, fullscreen: true, activity: 'coding', mood: 'energetic' },
      },
    });
    expect(resolution).toMatchObject({
      body: null,
      visible: false,
      face: 'energetic',
      accessory: 'laptop',
    });
  });

  it('ac_ac_5_activity_props_and_summer_outfit', () => {
    const engine = createEngine(config());
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    engine.handle({
      kind: 'event',
      now: 1,
      event: { type: 'season.changed', payload: { season: 'summer' } },
    });
    engine.handle({ kind: 'tick', now: 1001 });
    expect(
      engine.handle({
        kind: 'event',
        now: 1100,
        event: {
          type: 'app.category_changed',
          payload: { category: 'browsing', process: 'chrome.exe', title: 'News' },
        },
      }),
    ).toMatchObject({ body: 'browse', accessory: 'tablet', outfit: 'summer' });
    expect(
      engine.handle({
        kind: 'event',
        now: 1200,
        event: {
          type: 'app.category_changed',
          payload: { category: 'writing', process: 'notepad.exe', title: 'doc' },
        },
      }),
    ).toMatchObject({ body: 'write', accessory: 'notepad', outfit: 'summer' });
    expect(
      engine.handle({
        kind: 'event',
        now: 1300,
        event: {
          type: 'app.category_changed',
          payload: { category: 'coding', process: 'Code.exe', title: 'main' },
        },
      }),
    ).toMatchObject({ body: 'code', accessory: 'laptop', outfit: 'summer_glasses' });
  });

  it('ac_mu_3_level_jumps_only_while_playing_above_threshold', () => {
    const calls: number[] = [];
    const engine = createEngine(
      config(
        scripted(() => {
          calls.push(0);
          return 0;
        }),
      ),
    );
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    expect(
      engine.handle({
        kind: 'event',
        now: 10,
        event: { type: 'music.level', payload: { peak: 0.95 } },
      }),
    ).toMatchObject({ body: 'idle' });
    engine.handle({
      kind: 'event',
      now: 20,
      event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
    });
    engine.handle({ kind: 'tick', now: 1020 });
    expect(
      engine.handle({
        kind: 'event',
        now: 1100,
        event: { type: 'music.level', payload: { peak: 0.8 } },
      }),
    ).toMatchObject({ body: 'dance' });
    expect(
      engine.handle({
        kind: 'event',
        now: 1200,
        event: { type: 'music.level', payload: { peak: 0.81 } },
      }),
    ).toMatchObject({ body: 'jump' });
    expect(
      engine.handle({
        kind: 'event',
        now: 1300,
        event: { type: 'music.level', payload: { peak: 0.99 } },
      }),
    ).toMatchObject({ body: 'jump' });
    expect(calls).toEqual([...Array.from({ length: REACTIONS.length }, () => 0), 0]);
    engine.handle({ kind: 'tick', now: 2200 });
    engine.handle({ kind: 'event', now: 2300, event: { type: 'music.stopped', payload: {} } });
    expect(
      engine.handle({
        kind: 'event',
        now: 2400,
        event: { type: 'music.level', payload: { peak: 0.99 } },
      }),
    ).toMatchObject({ body: 'idle', accessory: null, overlay: null });
    expect(calls).toEqual([...Array.from({ length: REACTIONS.length }, () => 0), 0]);
  });

  it('ac_mu_4_track_bubble_clears_after_three_seconds', () => {
    const engine = createEngine(config());
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    expect(
      engine.handle({
        kind: 'event',
        now: 0,
        event: { type: 'music.track_changed', payload: { title: 'Line', artist: 'A' } },
      }),
    ).toMatchObject({ body: 'notice', bubble: 'Line' });
    expect(engine.handle({ kind: 'tick', now: 1000 })).toMatchObject({
      body: 'idle',
      bubble: 'Line',
    });
    expect(engine.handle({ kind: 'tick', now: 2999 })).toMatchObject({ bubble: 'Line' });
    expect(engine.handle({ kind: 'tick', now: 3000 })).toMatchObject({
      bubble: null,
      body: 'idle',
    });
  });

  it('ac_ms_5_stretch_once_per_day_and_yawn_only_while_sleepy', () => {
    const rolls: number[] = [];
    const engine = createEngine(
      config(
        scripted(() => {
          rolls.push(0);
          return 0;
        }),
      ),
    );
    engine.handle({
      kind: 'event',
      now: 0,
      event: {
        type: 'state.snapshot',
        payload: { ...snapshot.payload, activity: 'coding', mood: 'sleepy' },
      },
    });
    expect(engine.handle({ kind: 'tick', now: 19_999 }).body).toBe('code');
    expect(engine.handle({ kind: 'tick', now: 20_000 }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 21_000 }).body).toBe('code');
    engine.handle({
      kind: 'event',
      now: 21_000,
      event: { type: 'time.mood_changed', payload: { mood: 'content' } },
    });
    expect(engine.handle({ kind: 'tick', now: 400_000 }).body).toBe('code');
    expect(
      engine.handle({
        kind: 'event',
        now: 400_000,
        event: { type: 'time.mood_changed', payload: { mood: 'energetic' } },
      }).body,
    ).toBe('stretch');
    expect(engine.handle({ kind: 'tick', now: 401_000 }).body).toBe('code');
    expect(
      engine.handle({
        kind: 'event',
        now: 401_000,
        event: { type: 'time.mood_changed', payload: { mood: 'energetic' } },
      }).body,
    ).toBe('code');
    expect(
      engine.handle({
        kind: 'event',
        now: 400_000 + 86_400_000,
        event: { type: 'time.mood_changed', payload: { mood: 'energetic' } },
      }).body,
    ).toBe('stretch');
    expect(rolls.length).toBeGreaterThan(0);
  });

  it.each([
    { roll: 0, delay: 20_000 },
    { roll: 0.5, delay: 30_000 },
    { roll: 1 - Number.EPSILON, delay: 40_000 },
  ])('ac_ms_5_yawn_starts_at_$delay_ms_and_never_early', ({ roll, delay }) => {
    const engine = createEngine(config(scripted(() => roll)), []);
    engine.handle({
      kind: 'event',
      now: 500,
      event: { type: 'time.mood_changed', payload: { mood: 'sleepy' } },
    });
    expect(engine.handle({ kind: 'tick', now: 500 + delay - 1 }).body).toBe('idle');
    expect(engine.handle({ kind: 'tick', now: 500 + delay }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 1500 + delay }).body).toBe('idle');
  });

  it('ac_ms_5_each_yawn_schedules_a_fresh_random_interval', () => {
    const rolls = [0, 1 - Number.EPSILON, 0.5];
    const engine = createEngine(config(scripted(() => rolls.shift() ?? 0)), []);
    engine.handle({
      kind: 'event',
      now: 0,
      event: { type: 'time.mood_changed', payload: { mood: 'sleepy' } },
    });
    expect(engine.handle({ kind: 'tick', now: 20_000 }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 59_999 }).body).toBe('idle');
    expect(engine.handle({ kind: 'tick', now: 60_000 }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 89_999 }).body).toBe('idle');
    expect(engine.handle({ kind: 'tick', now: 90_000 }).body).toBe('yawn');
  });

  it('ac_ms_5_leaving_sleepy_cancels_the_deadline_and_reentry_starts_fresh', () => {
    const engine = createEngine(config(scripted(() => 0)), []);
    engine.handle({
      kind: 'event',
      now: 0,
      event: { type: 'time.mood_changed', payload: { mood: 'sleepy' } },
    });
    engine.handle({
      kind: 'event',
      now: 19_000,
      event: { type: 'time.mood_changed', payload: { mood: 'content' } },
    });
    expect(engine.handle({ kind: 'tick', now: 20_000 }).body).toBe('idle');
    expect(engine.handle({ kind: 'tick', now: 80_000 }).body).toBe('idle');
    engine.handle({
      kind: 'event',
      now: 90_000,
      event: { type: 'time.mood_changed', payload: { mood: 'sleepy' } },
    });
    expect(engine.handle({ kind: 'tick', now: 109_999 }).body).toBe('idle');
    expect(engine.handle({ kind: 'tick', now: 110_000 }).body).toBe('yawn');
  });

  it('ac_ms_5_sleepy_music_and_coding_pause_bob_for_yawn_then_resume_work', () => {
    const engine = createEngine(config(scripted(() => 0)));
    engine.handle({
      kind: 'event',
      now: 0,
      event: {
        ...snapshot,
        payload: {
          ...snapshot.payload,
          activity: 'coding',
          mood: 'sleepy',
          music: { playing: true },
        },
      },
    });
    const working = {
      body: 'code',
      face: 'sleepy',
      accessory: 'headphones',
      overlay: 'headbob',
      speed: 0.7,
    };
    expect(engine.handle({ kind: 'tick', now: 19_999 })).toMatchObject(working);
    expect(engine.handle({ kind: 'tick', now: 20_000 })).toMatchObject({
      ...working,
      body: 'yawn',
      overlay: null,
    });
    expect(engine.handle({ kind: 'tick', now: 20_999 }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 21_000 })).toMatchObject(working);
  });

  it('ac_pt_3_petting_outranks_a_one_shot_and_hidden_outranks_petting', () => {
    const engine = createEngine(config());
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    engine.handle({
      kind: 'event',
      now: 0,
      event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
    });
    expect(
      engine.handle({ kind: 'event', now: 10, event: { type: 'pet.hover_start', payload: {} } }),
    ).toMatchObject({
      body: 'idle',
      move: 'stay',
    });
    expect(
      engine.handle({ kind: 'event', now: 20, event: { type: 'fullscreen.entered', payload: {} } }),
    ).toMatchObject({ body: 'hide', visible: true });
    expect(engine.handle({ kind: 'tick', now: 1020 })).toMatchObject({
      body: null,
      visible: false,
    });
  });

  it('composes reaction contributions and lets their effects replace builtin one-shots', () => {
    let reduces = 0;
    let ticks = 0;
    let contributes = 0;
    const probe = defineReaction<null>({
      id: 'music',
      init: () => null,
      reduce: (slice, event) => {
        reduces += 1;
        return {
          slice,
          effects: event.type === 'music.started' ? [{ kind: 'oneShot', animation: 'notice' }] : [],
        };
      },
      tick: (slice) => {
        ticks += 1;
        return { slice, effects: [] };
      },
      contribute: () => {
        contributes += 1;
        return { tier: 'activity', body: 'think' };
      },
    });
    const engine = createEngine(config(), [probe]);
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    engine.handle({
      kind: 'event',
      now: 10,
      event: {
        type: 'app.category_changed',
        payload: { category: 'coding', process: 'Code.exe', title: 'x' },
      },
    });
    expect(engine.handle({ kind: 'tick', now: 10 })).toMatchObject({
      body: 'think',
      accessory: 'laptop',
    });
    expect(
      engine.handle({
        kind: 'event',
        now: 20,
        event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
      }).body,
    ).toBe('notice');
    expect(engine.handle({ kind: 'tick', now: 1020 }).body).toBe('think');
    expect(engine.handle({ kind: 'tick', now: 1500 }).body).toBe('think');
    expect(reduces).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(0);
    expect(contributes).toBeGreaterThan(0);
  });

  it('hides when a reaction contributes hidden', () => {
    const hider = defineReaction<null>({
      id: 'fullscreen',
      init: () => null,
      reduce: (slice) => ({ slice, effects: [] }),
      tick: (slice) => ({ slice, effects: [] }),
      contribute: () => ({ tier: 'hidden', hidden: true }),
    });
    const engine = createEngine(config(), [hider]);
    expect(engine.handle({ kind: 'tick', now: 0 })).toMatchObject({ body: null, visible: false });
  });

  it('an activity tick effect does not suppress a due yawn', () => {
    const activity = defineReaction<null>({
      id: 'activity',
      init: () => null,
      reduce: (slice) => ({ slice, effects: [] }),
      tick: (slice, ctx) => ({
        slice,
        effects: ctx.now === 20_000 ? [{ kind: 'oneShot', animation: 'wag' }] : [],
      }),
      contribute: () => null,
    });
    const engine = createEngine(config(scripted(() => 0)), [activity]);
    engine.handle({
      kind: 'event',
      now: 0,
      event: {
        type: 'state.snapshot',
        payload: { ...snapshot.payload, activity: 'coding', mood: 'sleepy' },
      },
    });
    expect(engine.handle({ kind: 'tick', now: 20_000 }).body).toBe('yawn');
    expect(engine.handle({ kind: 'tick', now: 21_000 }).body).toBe('wag');
  });

  it('a music reaction effect replaces the default notice', () => {
    const music = defineReaction<null>({
      id: 'music',
      init: () => null,
      reduce: (slice, event) => ({
        slice,
        effects: event.type === 'music.started' ? [{ kind: 'oneShot', animation: 'jump' }] : [],
      }),
      tick: (slice) => ({ slice, effects: [] }),
      contribute: () => null,
    });
    const engine = createEngine(config(), [music]);
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    expect(
      engine.handle({
        kind: 'event',
        now: 10,
        event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
      }).body,
    ).toBe('jump');
  });

  it('a same-tier body contribution from a reaction beats the engine', () => {
    const sitter = defineReaction<null>({
      id: 'activity',
      init: () => null,
      reduce: (slice) => ({ slice, effects: [] }),
      tick: (slice) => ({ slice, effects: [] }),
      contribute: () => ({ tier: 'idle', body: 'sit' }),
    });
    const engine = createEngine(config(), [sitter]);
    expect(engine.handle({ kind: 'tick', now: 0 }).body).toBe('sit');
  });

  it('a reaction random draw does not change the default jump', () => {
    const script = [0.01, 0];
    let draws = 0;
    let reactionDraws = 0;
    const rng: Rng = {
      next: () => {
        const value = script[draws] ?? 0.99;
        draws += 1;
        return value;
      },
    };
    const music = defineReaction<null>({
      id: 'music',
      init: () => null,
      reduce: (slice, _event, ctx) => {
        reactionDraws += 1;
        ctx.rng.next();
        return { slice, effects: [] };
      },
      tick: (slice) => ({ slice, effects: [] }),
      contribute: () => null,
    });
    const engine = createEngine(config(rng), [music]);
    engine.handle({ kind: 'event', now: 0, event: snapshot });
    engine.handle({
      kind: 'event',
      now: 0,
      event: { type: 'music.started', payload: { title: 't', artist: 'a', sourceApp: 'app' } },
    });
    engine.handle({ kind: 'tick', now: 1000 });
    expect(
      engine.handle({
        kind: 'event',
        now: 1100,
        event: { type: 'music.level', payload: { peak: 0.95 } },
      }).body,
    ).toBe('jump');
    expect(draws).toBe(2);
    expect(reactionDraws).toBeGreaterThan(0);
  });
});

describe('drag and simultaneous activities', () => {
  it.each(['other', 'coding', 'writing', 'browsing'] as const)(
    'walks, settles, then resumes %s with music',
    (activity) => {
      const engine = createEngine(config(scripted(() => 0)));
      const event = (type: 'pet.drag_start' | 'pet.drag_end', now: number) =>
        engine.handle({ kind: 'event', now, event: { type, payload: {} } });
      engine.handle({
        kind: 'event',
        now: 0,
        event: {
          ...snapshot,
          payload: { ...snapshot.payload, activity, music: { playing: true } },
        },
      });
      expect(event('pet.drag_start', 1)).toMatchObject({ body: 'walk', overlay: null });
      expect(
        engine.handle({
          kind: 'event',
          now: 100,
          event: { type: 'music.level', payload: { peak: 1 } },
        }),
      ).toMatchObject({ body: 'walk', overlay: null });
      expect(event('pet.drag_end', 200)).toMatchObject({ body: 'sit', overlay: null });
      expect(
        engine.handle({ kind: 'event', now: 300, event: { type: 'pet.hover_start', payload: {} } })
          .body,
      ).toBe('sit');
      expect(engine.handle({ kind: 'tick', now: 1699 }).body).toBe('sit');
      expect(engine.handle({ kind: 'tick', now: 1700 }).body).toBe(
        { other: 'dance', coding: 'code', writing: 'write', browsing: 'browse' }[activity],
      );
    },
  );
  it('returns to idle after settling and suppresses work props during drag', () => {
    const engine = createEngine(config());
    engine.handle({
      kind: 'event',
      now: 0,
      event: { ...snapshot, payload: { ...snapshot.payload, activity: 'coding' } },
    });
    expect(
      engine.handle({ kind: 'event', now: 1, event: { type: 'pet.drag_start', payload: {} } }),
    ).toMatchObject({ body: 'walk', accessory: null });
    engine.handle({
      kind: 'event',
      now: 2,
      event: {
        type: 'app.category_changed',
        payload: { category: 'other', process: '', title: '' },
      },
    });
    engine.handle({ kind: 'event', now: 3, event: { type: 'pet.drag_end', payload: {} } });
    expect(engine.handle({ kind: 'tick', now: 1503 }).body).toBe('idle');
  });
  it.each(['coding', 'writing', 'browsing'] as const)(
    'never interrupts %s with loud-music jumps',
    (activity) => {
      const engine = createEngine(config(scripted(() => 0)));
      engine.handle({
        kind: 'event',
        now: 0,
        event: {
          ...snapshot,
          payload: { ...snapshot.payload, activity, music: { playing: true } },
        },
      });
      for (let now = 1; now < 100; now++)
        expect(
          engine.handle({
            kind: 'event',
            now,
            event: { type: 'music.level', payload: { peak: 1 } },
          }).body,
        ).toBe({ coding: 'code', writing: 'write', browsing: 'browse' }[activity]);
    },
  );
  it('hides during dragging and does not revive a hidden pet on release', () => {
    const engine = createEngine(config());
    engine.handle({ kind: 'event', now: 0, event: { type: 'pet.drag_start', payload: {} } });
    expect(
      engine.handle({ kind: 'event', now: 1, event: { type: 'fullscreen.entered', payload: {} } })
        .body,
    ).toBe('hide');
    engine.handle({ kind: 'tick', now: 1001 });
    expect(
      engine.handle({ kind: 'event', now: 1002, event: { type: 'pet.drag_end', payload: {} } })
        .visible,
    ).toBe(false);
  });
});
