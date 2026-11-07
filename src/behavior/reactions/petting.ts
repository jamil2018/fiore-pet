import { defineReaction } from '../types';

export const pettingReaction = defineReaction<Record<string, never>>({
  id: 'petting',
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
