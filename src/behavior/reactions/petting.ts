import { defineReaction, type Facing, switchEvent } from '../types';

interface PettingSlice {
  hovering: boolean;
  facing: Facing | null;
}

function resting(): PettingSlice {
  return { hovering: false, facing: null };
}

export const pettingReaction = defineReaction<PettingSlice>({
  id: 'petting',
  init() {
    return resting();
  },
  reduce(slice, event) {
    const next = switchEvent<PettingSlice>(event, {
      'state.snapshot': () => resting(),
      'fullscreen.entered': () => resting(),
      'fullscreen.exited': () => slice,
      'pet.hover_start': () => ({ hovering: true, facing: null }),
      'pet.stroke': (stroke) =>
        slice.hovering ? { hovering: true, facing: stroke.payload.direction } : slice,
      'pet.petted': () => slice,
      'pet.hover_end': () => resting(),
      'app.category_changed': () => slice,
      'music.started': () => slice,
      'music.level': () => slice,
      'music.track_changed': () => slice,
      'music.stopped': () => slice,
      'time.mood_changed': () => slice,
      'season.changed': () => slice,
    });
    return { slice: next, effects: [] };
  },
  tick(slice) {
    return { slice, effects: [] };
  },
  contribute(slice) {
    if (!slice.hovering || slice.facing === null) return null;
    return { tier: 'petting', facing: slice.facing };
  },
});
