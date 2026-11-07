import { defineReaction } from '../types';

export const seasonReaction = defineReaction<Record<string, never>>({
  id: 'season',
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
