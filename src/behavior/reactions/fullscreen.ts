import { defineReaction } from '../types';

// Hide, appear, and the hidden tier stay in the engine, so this reaction emits nothing.
export const fullscreenReaction = defineReaction<Record<string, never>>({
  id: 'fullscreen',
  init() {
    return {};
  },
  reduce(slice) {
    return { slice, effects: [] };
  },
  tick(slice) {
    return { slice, effects: [] };
  },
  contribute() {
    return null;
  },
});
