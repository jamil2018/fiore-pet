import { describe, expect, it, vi } from 'vitest';

import { createMockBridge, mockWindowCalls } from '../bridge/mock';
import { createMover } from './mover';

describe('manual window movement', () => {
  it('never schedules or performs automatic position changes', async () => {
    const bridge = createMockBridge();
    const drag = vi.fn(async () => {});
    createMover(bridge, { startDragging: drag });
    await Promise.resolve();
    expect(drag).not.toHaveBeenCalled();
    expect(mockWindowCalls(bridge)).toEqual([]);
  });

  it('starts one native drag for simultaneous requests', async () => {
    let release: (() => void) | undefined;
    const drag = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const mover = createMover(createMockBridge(), { startDragging: drag });
    const first = mover.startDragging();
    const second = mover.startDragging();
    await Promise.resolve();
    expect(drag).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    release?.();
    await first;
  });

  it('allows another user drag after the previous drag failed', async () => {
    const drag = vi
      .fn()
      .mockRejectedValueOnce(new Error('window unavailable'))
      .mockResolvedValue(undefined);
    const mover = createMover(createMockBridge(), { startDragging: drag });
    await expect(mover.startDragging()).rejects.toThrow('window unavailable');
    await expect(mover.startDragging()).resolves.toBeUndefined();
    expect(drag).toHaveBeenCalledTimes(2);
  });

  it('does not call native APIs or reposition in mock mode', async () => {
    const bridge = createMockBridge();
    await expect(createMover(bridge).startDragging()).resolves.toBeUndefined();
    expect(mockWindowCalls(bridge)).toEqual([]);
  });
});

it('keeps the drag active until the physical mouse release, not native acknowledgement', async () => {
  let release: (() => void) | undefined;
  const complete = vi.fn();
  const mover = createMover(createMockBridge(), {
    startDragging: async () => {},
    waitForRelease: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const pending = mover.startDragging().then(complete);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(release).toBeDefined());
  if (!release) throw new Error('release waiter not started');
  release();
  await pending;
  expect(complete).toHaveBeenCalledOnce();
});
