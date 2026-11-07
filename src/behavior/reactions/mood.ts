import { defineReaction } from '../types';

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
