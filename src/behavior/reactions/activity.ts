import { defineReaction } from '../types';

export const activityReaction = defineReaction<Record<string, never>>({
  id: 'activity',
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
