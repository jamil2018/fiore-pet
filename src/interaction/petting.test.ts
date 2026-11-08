import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { FioreEvent } from '../events';
import { createPettingDetector, createStrokeTracker, type StrokeTracker } from './petting';

function armed(): StrokeTracker {
  const tracker = createStrokeTracker();
  tracker.enter(0);
  tracker.move(0, 0);
  tracker.move(40, 0);
  return tracker;
}

describe('createStrokeTracker', () => {
  it('ac_pt_1_twelve_pixel_reversal', () => {
    const tracker = armed();
    expect(tracker.move(29, 10)).toEqual([]);
    expect(tracker.move(28, 20)).toEqual([{ type: 'pet.stroke', payload: { direction: 'left' } }]);
  });

  it('keeps the extreme across a short reversal', () => {
    const tracker = armed();
    expect(tracker.move(29, 10)).toEqual([]);
    expect(tracker.move(52, 20)).toEqual([]);
    expect(tracker.move(40, 30)).toEqual([{ type: 'pet.stroke', payload: { direction: 'left' } }]);
  });

  it('reports the new direction of each reversal', () => {
    const tracker = armed();
    expect(tracker.move(28, 10)).toEqual([{ type: 'pet.stroke', payload: { direction: 'left' } }]);
    expect(tracker.move(40, 20)).toEqual([{ type: 'pet.stroke', payload: { direction: 'right' } }]);
  });

  it('ac_pt_2_three_strokes_in_two_seconds_emit_petted', () => {
    const tracker = armed();
    expect(tracker.move(28, 0)).toEqual([{ type: 'pet.stroke', payload: { direction: 'left' } }]);
    expect(tracker.move(40, 1000)).toEqual([
      { type: 'pet.stroke', payload: { direction: 'right' } },
    ]);
    expect(tracker.move(28, 2000)).toEqual([
      { type: 'pet.stroke', payload: { direction: 'left' } },
      { type: 'pet.petted', payload: {} },
    ]);
    expect(tracker.move(40, 2100)).toEqual([
      { type: 'pet.stroke', payload: { direction: 'right' } },
    ]);
  });

  it('ac_pt_2_three_strokes_over_two_and_a_half_seconds_do_not_pet', () => {
    const tracker = armed();
    expect(tracker.move(28, 0)).toEqual([{ type: 'pet.stroke', payload: { direction: 'left' } }]);
    expect(tracker.move(40, 1000)).toEqual([
      { type: 'pet.stroke', payload: { direction: 'right' } },
    ]);
    expect(tracker.move(28, 2500)).toEqual([
      { type: 'pet.stroke', payload: { direction: 'left' } },
    ]);
  });

  it('sets wasPetted only after pet.petted in this hover', () => {
    const quiet = createStrokeTracker();
    quiet.enter(0);
    expect(quiet.leave(10)).toEqual([{ type: 'pet.hover_end', payload: { wasPetted: false } }]);

    const one = armed();
    one.move(28, 10);
    expect(one.leave(20)).toEqual([{ type: 'pet.hover_end', payload: { wasPetted: false } }]);

    const petted = armed();
    petted.move(28, 0);
    petted.move(40, 1000);
    petted.move(28, 2000);
    expect(petted.leave(2100)).toEqual([{ type: 'pet.hover_end', payload: { wasPetted: true } }]);

    expect(petted.enter(3000)).toEqual([{ type: 'pet.hover_start', payload: {} }]);
    expect(petted.leave(3100)).toEqual([{ type: 'pet.hover_end', payload: { wasPetted: false } }]);
  });

  it('stays quiet outside a hover and ignores a second enter', () => {
    const tracker = createStrokeTracker();
    expect(tracker.move(12, 0)).toEqual([]);
    expect(tracker.leave(0)).toEqual([]);
    expect(tracker.enter(0)).toEqual([{ type: 'pet.hover_start', payload: {} }]);
    expect(tracker.enter(5)).toEqual([]);
  });
});

interface PointerSample {
  clientX: number;
  timeStamp: number;
  button?: number;
  buttons?: number;
}

function fakeTarget(): HTMLElement & {
  dispatch(type: string, init: PointerSample): void;
} {
  const listeners = new Map<string, Set<EventListener>>();
  const target = {
    addEventListener(type: string, listener: EventListener) {
      const group = listeners.get(type) ?? new Set<EventListener>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, init: PointerSample) {
      const event = { button: 0, buttons: 0, preventDefault() {}, ...init } as unknown as Event;
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
  return target as HTMLElement & typeof target;
}

describe('createPettingDetector', () => {
  it('ac_win_2_primary dragging ends hover and suppresses strokes until completion', async () => {
    const target = fakeTarget();
    const emitted: FioreEvent[] = [];
    let finish: (() => void) | undefined;
    const drag = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    createPettingDetector(target, (event) => emitted.push(event), { startDragging: drag });
    target.dispatch('pointerenter', { clientX: 0, timeStamp: 0 });
    target.dispatch('pointerdown', { clientX: 0, timeStamp: 1, buttons: 1 });
    target.dispatch('pointerdown', { clientX: 0, timeStamp: 2, buttons: 1 });
    for (const x of [0, 40, 28, 40, 28])
      target.dispatch('pointermove', { clientX: x, timeStamp: 3, buttons: 1 });
    target.dispatch('pointermove', { clientX: 12, timeStamp: 4 });
    expect(drag).toHaveBeenCalledTimes(1);
    expect(emitted.map((event) => event.type)).toEqual([
      'pet.hover_start',
      'pet.hover_end',
      'pet.drag_start',
    ]);
    finish?.();
    await Promise.resolve();
    for (const x of [0, 40, 28, 40, 28])
      target.dispatch('pointermove', { clientX: x, timeStamp: 10 });
    expect(emitted.map((event) => event.type)).toEqual([
      'pet.hover_start',
      'pet.hover_end',
      'pet.drag_start',
      'pet.drag_end',
      'pet.hover_start',
      'pet.stroke',
      'pet.stroke',
      'pet.stroke',
      'pet.petted',
    ]);
  });

  it('ignores non-primary dragging and resets hover on pointer cancellation', () => {
    const target = fakeTarget();
    const emitted: FioreEvent[] = [];
    const drag = vi.fn(async () => {});
    const stop = createPettingDetector(target, (event) => emitted.push(event), {
      startDragging: drag,
    });
    target.dispatch('pointerenter', { clientX: 0, timeStamp: 0 });
    target.dispatch('pointerdown', { clientX: 0, timeStamp: 1, button: 2, buttons: 2 });
    target.dispatch('pointercancel', { clientX: 0, timeStamp: 2 });
    expect(drag).not.toHaveBeenCalled();
    expect(emitted.at(-1)?.type).toBe('pet.hover_end');
    stop();
    target.dispatch('pointerdown', { clientX: 0, timeStamp: 3, buttons: 1 });
    expect(drag).not.toHaveBeenCalled();
  });

  it('restores hover after a rejected native drag without an unhandled rejection', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const target = fakeTarget();
      const emitted: FioreEvent[] = [];
      createPettingDetector(target, (event) => emitted.push(event), {
        startDragging: async () => {
          throw new Error('denied');
        },
      });
      target.dispatch('pointerdown', { clientX: 0, timeStamp: 0, buttons: 1 });
      await Promise.resolve();
      target.dispatch('pointermove', { clientX: 0, timeStamp: 1 });
      expect(emitted.map((event) => event.type)).toEqual([
        'pet.drag_start',
        'pet.drag_end',
        'pet.hover_start',
      ]);
      expect(debug).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
    }
  });

  it('emits pointer strokes and cleanup drops the listeners', () => {
    const emitted: FioreEvent[] = [];
    const target = fakeTarget();
    const stop = createPettingDetector(target, (event) => {
      emitted.push(event);
    });
    target.dispatch('pointerenter', { clientX: 0, timeStamp: 0 });
    target.dispatch('pointermove', { clientX: 0, timeStamp: 0 });
    target.dispatch('pointermove', { clientX: 40, timeStamp: 0 });
    target.dispatch('pointermove', { clientX: 28, timeStamp: 0 });
    target.dispatch('pointermove', { clientX: 40, timeStamp: 1000 });
    target.dispatch('pointermove', { clientX: 28, timeStamp: 2000 });
    target.dispatch('pointerleave', { clientX: 28, timeStamp: 2100 });
    expect(emitted).toEqual([
      { type: 'pet.hover_start', payload: {} },
      { type: 'pet.stroke', payload: { direction: 'left' } },
      { type: 'pet.stroke', payload: { direction: 'right' } },
      { type: 'pet.stroke', payload: { direction: 'left' } },
      { type: 'pet.petted', payload: {} },
      { type: 'pet.hover_end', payload: { wasPetted: true } },
    ]);
    stop();
    target.dispatch('pointerenter', { clientX: 0, timeStamp: 3000 });
    target.dispatch('pointermove', { clientX: 20, timeStamp: 3100 });
    target.dispatch('pointerleave', { clientX: 20, timeStamp: 3200 });
    expect(emitted).toHaveLength(6);
    stop();
  });

  it('ac_pt_5_no_keyboard_listeners', () => {
    const source = readFileSync(fileURLToPath(new URL('./petting.ts', import.meta.url)), 'utf8');
    expect(source).toContain("addEventListener('pointerenter'");
    expect(source).toContain("addEventListener('pointermove'");
    expect(source).toContain("addEventListener('pointerleave'");
    expect(source).not.toMatch(/addEventListener\(\s*['"]key/);
    expect(source).not.toMatch(/\bkey(?:down|up|press)\b/);
    expect(source).not.toMatch(/\bset(?:Timeout|Interval)\b/);
    expect(source).not.toMatch(/\brequestAnimationFrame\b/);
  });
});
