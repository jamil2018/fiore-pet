import { describe, expect, it } from 'vitest';

import type { FioreEvent } from '../../events';
import type { Contribution, ReactionContext, World } from '../types';
import { pettingReaction } from './petting';

const world: World = {
  activity: 'other',
  mood: 'content',
  season: 'autumn',
  fullscreen: false,
  music: { playing: false },
  peak: 0,
};

function ctx(): ReactionContext {
  const rng = { next: () => 0 };
  return { now: 0, rng, world, config: { rng, oneShotMs: {} } };
}

function apply(
  slice: unknown,
  event: FioreEvent,
): { slice: unknown; contribution: Contribution | null } {
  const reduced = pettingReaction.reduce(slice, event, ctx());
  expect(reduced.effects).toEqual([]);
  return {
    slice: reduced.slice,
    contribution: pettingReaction.contribute(reduced.slice, ctx()),
  };
}

describe('pettingReaction', () => {
  it('contributes the last stroke direction and never a body', () => {
    let slice = pettingReaction.init(world);
    expect(pettingReaction.contribute(slice, ctx())).toBeNull();

    ({ slice } = apply(slice, { type: 'pet.stroke', payload: { direction: 'left' } }));
    expect(pettingReaction.contribute(slice, ctx())).toBeNull();

    ({ slice } = apply(slice, { type: 'pet.hover_start', payload: {} }));
    expect(pettingReaction.contribute(slice, ctx())).toBeNull();

    let contribution: Contribution | null;
    ({ slice, contribution } = apply(slice, {
      type: 'pet.stroke',
      payload: { direction: 'left' },
    }));
    expect(contribution).toEqual({ tier: 'petting', facing: 'left' });
    expect(contribution).not.toHaveProperty('body');

    ({ slice, contribution } = apply(slice, {
      type: 'pet.stroke',
      payload: { direction: 'right' },
    }));
    expect(contribution).toEqual({ tier: 'petting', facing: 'right' });

    ({ slice, contribution } = apply(slice, { type: 'pet.petted', payload: {} }));
    expect(contribution).toEqual({ tier: 'petting', facing: 'right' });

    ({ slice, contribution } = apply(slice, {
      type: 'pet.hover_end',
      payload: { wasPetted: true },
    }));
    expect(contribution).toBeNull();
  });

  it('clears facing when fullscreen cancels the hover', () => {
    let slice = pettingReaction.init(world);
    ({ slice } = apply(slice, { type: 'pet.hover_start', payload: {} }));
    ({ slice } = apply(slice, { type: 'pet.stroke', payload: { direction: 'left' } }));
    const cleared = apply(slice, { type: 'fullscreen.entered', payload: {} });
    expect(cleared.contribution).toBeNull();
  });
});
