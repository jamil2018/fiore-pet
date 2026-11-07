import { defineReaction } from '../types';

// Stretch, yawn, face, and speed stay in the engine. Effects here would suppress them.
export const moodReaction = defineReaction<Record<string, never>>({
  id: 'mood',
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
