import type { AnyReaction } from '../types';
import { activityReaction } from './activity';
import { fullscreenReaction } from './fullscreen';
import { moodReaction } from './mood';
import { musicReaction } from './music';
import { pettingReaction } from './petting';
import { seasonReaction } from './season';

export const REACTIONS: readonly AnyReaction[] = [
  fullscreenReaction,
  pettingReaction,
  activityReaction,
  musicReaction,
  moodReaction,
  seasonReaction,
];
