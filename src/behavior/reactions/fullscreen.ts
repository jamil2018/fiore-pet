import { defineReaction } from '../types';

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
