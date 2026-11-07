import { defineReaction } from '../types';

// Twirl and the outfit stay in the engine. Effects here would suppress the first twirl.
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
