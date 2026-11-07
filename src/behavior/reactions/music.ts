import { defineReaction } from '../types';

export const musicReaction = defineReaction<Record<string, never>>({
  id: 'music',
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
