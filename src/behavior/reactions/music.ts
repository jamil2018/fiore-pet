import { defineReaction, switchEvent } from '../types';

/** Exponential moving average weight for `music.level` peaks. */
const LEVEL_ALPHA = 0.3;

interface MusicSlice {
  level: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function smooth(level: number, peak: number): number {
  return clamp01(level + LEVEL_ALPHA * (peak - level));
}

function keep(slice: MusicSlice): { slice: MusicSlice; effects: [] } {
  return { slice, effects: [] };
}

export const musicReaction = defineReaction<MusicSlice>({
  id: 'music',
  init() {
    return { level: 0 };
  },
  reduce(slice, event, ctx) {
    // notice, jump, the bubble, and headphones stay in the engine.
    // Emitting effects here would replace those defaults.
    return switchEvent(event, {
      'state.snapshot': (snapshot) =>
        snapshot.payload.music.playing ? keep(slice) : { slice: { level: 0 }, effects: [] },
      'fullscreen.entered': () => keep(slice),
      'fullscreen.exited': () => keep(slice),
      'pet.hover_start': () => keep(slice),
      'pet.stroke': () => keep(slice),
      'pet.petted': () => keep(slice),
      'pet.hover_end': () => keep(slice),
      'app.category_changed': () => keep(slice),
      'music.started': () => keep(slice),
      'music.level': (level) => {
        if (!ctx.world.music.playing) return keep(slice);
        return { slice: { level: smooth(slice.level, level.payload.peak) }, effects: [] };
      },
      'music.track_changed': () => keep(slice),
      'music.stopped': () => ({ slice: { level: 0 }, effects: [] }),
      'time.mood_changed': () => keep(slice),
      'season.changed': () => keep(slice),
    });
  },
  tick(slice) {
    return keep(slice);
  },
  contribute(slice, ctx) {
    if (!ctx.world.music.playing) return null;
    return { tier: 'music', overlayLevel: slice.level };
  },
});
