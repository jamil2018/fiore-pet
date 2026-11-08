import { describe, expect, it, vi } from 'vitest';

import type { Resolution } from '../behavior/types';
import { createAnimator, createSpeechBubble, frameIndex } from './animator';
import { type AnimationDef, type MergedAtlas, mergeAtlases, rememberSprite } from './atlas';

const pet = {} as CanvasImageSource;

function anim(partial: AnimationDef): AnimationDef {
  return partial;
}

function atlas(articulated = false): MergedAtlas {
  return mergeAtlases([
    {
      version: 1,
      group: 'base',
      frame: { w: 32, h: 32 },
      sheets: [
        {
          layer: 'body',
          image: 'pet.png',
          animations: {
            idle: anim({
              ...(articulated ? { motionSplit: 16 } : {}),
              row: 0,
              start: 0,
              count: 4,
              fps: 4,
              loop: true,
              headOffset: [
                [0, 0],
                [0, -1],
                [0, 0],
                [0, 1],
              ],
            }),
            walk: anim({
              row: 1,
              start: 0,
              count: 2,
              fps: 4,
              loop: true,
              headOffset: [
                [2, 0],
                [0, 0],
              ],
            }),
            headbob: anim({
              row: 2,
              start: 0,
              count: 4,
              fps: 8,
              loop: true,
              headOffset: [
                [0, 0],
                [0, -2],
                [0, 0],
                [0, -2],
              ],
            }),
            jump: anim({ row: 3, start: 0, count: 4, fps: 4, loop: false }),
          },
        },
        {
          layer: 'face',
          image: 'pet.png',
          variant: 'content',
          animations: {
            '*': anim({ row: 4, start: 0, count: 1, fps: 1, loop: true }),
            walk: anim({ row: 5, start: 0, count: 2, fps: 4, loop: true }),
          },
        },
        {
          layer: 'outfit',
          image: 'pet.png',
          variant: 'autumn',
          animations: {
            idle: anim({ row: 6, start: 0, count: 4, fps: 4, loop: true }),
          },
        },
        {
          layer: 'accessory',
          image: 'pet.png',
          variant: 'headphones',
          animations: {
            '*': anim({ row: 7, start: 1, count: 1, fps: 1, loop: true }),
          },
        },
      ],
    },
  ]);
}

function resolution(partial: Partial<Resolution> = {}): Resolution {
  return {
    body: 'idle',
    face: null,
    outfit: null,
    accessory: null,
    overlay: null,
    speed: 1,
    bubble: null,
    visible: true,
    move: 'stay',
    facing: 'right',
    overlayLevel: 0,
    ...partial,
  };
}

interface Recorded {
  draws: number[][];
  transforms: number[][];
  restores: number;
  clears: number;
  smoothing: boolean;
}

function fakeCanvas(): { canvas: HTMLCanvasElement; recorded: Recorded } {
  const recorded: Recorded = { draws: [], transforms: [], restores: 0, clears: 0, smoothing: true };
  let width = 0;
  let height = 0;
  const ctx = {
    save() {},
    restore() {
      recorded.restores += 1;
    },
    translate(x: number, y: number) {
      recorded.transforms.push([x, y]);
    },
    scale(x: number, y: number) {
      recorded.transforms.push([x, y]);
    },
    get imageSmoothingEnabled() {
      return recorded.smoothing;
    },
    set imageSmoothingEnabled(value: boolean) {
      recorded.smoothing = value;
    },
    clearRect() {
      recorded.clears += 1;
    },
    drawImage(
      _image: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) {
      recorded.draws.push([sx, sy, sw, sh, dx, dy, dw, dh]);
    },
  };
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      recorded.smoothing = true;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      recorded.smoothing = true;
    },
    style: { width: '', height: '', imageRendering: '' },
    getContext() {
      return ctx;
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, recorded };
}

describe('frameIndex', () => {
  const loop: AnimationDef = { row: 0, start: 0, count: 4, fps: 4, loop: true };
  const once: AnimationDef = { row: 0, start: 0, count: 4, fps: 4, loop: false };

  it('wraps loops, holds one-shots, and scales with speed', () => {
    expect(frameIndex(loop, 0, 1)).toBe(0);
    expect(frameIndex(loop, 250, 1)).toBe(1);
    expect(frameIndex(loop, 999, 1)).toBe(3);
    expect(frameIndex(loop, 1000, 1)).toBe(0);
    expect(frameIndex(loop, 250, 2)).toBe(2);
    expect(frameIndex(once, 10_000, 1)).toBe(3);
    expect(frameIndex(loop, 500, 0)).toBe(0);
    expect(frameIndex({ ...loop, count: 1 }, 500, 1)).toBe(0);
  });
});

describe('speech bubble', () => {
  it('uses literal text, a fixed music icon and overflow-only scrolling', () => {
    const cancel = vi.fn();
    const nodes: ReturnType<typeof element>[] = [];
    function element() {
      return {
        style: {},
        hidden: false,
        textContent: '',
        scrollWidth: 60,
        clientWidth: 100,
        setAttribute: vi.fn(),
        append: vi.fn(),
        animate: vi.fn(() => ({ cancel })),
      };
    }
    const canvas = {
      style: {},
      removeAttribute: vi.fn(),
      after: vi.fn(),
      ownerDocument: {
        createElement: () => {
          const node = element();
          nodes.push(node);
          return node;
        },
      },
    };
    const render = createSpeechBubble(canvas as unknown as HTMLCanvasElement);
    const [bubble, icon, viewport, label] = nodes;
    if (!bubble || !icon || !viewport || !label) throw new Error('missing banner nodes');
    render(resolution({ bubble: 'Short song' }));
    expect(icon.textContent).toBe('♫');
    expect(icon.hidden).toBe(false);
    expect(label.animate).not.toHaveBeenCalled();
    expect(canvas.removeAttribute).toHaveBeenCalledWith('title');
    label.scrollWidth = 300;
    render(resolution({ bubble: '<img src=x onerror=alert(1)>' }));
    expect(label.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(label.animate).toHaveBeenCalledTimes(1);
    expect(label.animate.mock.calls[0]).toEqual([
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: 0.15 },
        { transform: 'translateX(-200px)', offset: 0.85 },
        { transform: 'translateX(-200px)', offset: 1 },
      ],
      { duration: 2800, iterations: Infinity, direction: 'alternate' },
    ]);
    render(resolution({ bubble: '<img src=x onerror=alert(1)>' }));
    expect(label.animate).toHaveBeenCalledTimes(1);
    render(resolution({ bubble: null }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(bubble.hidden).toBe(true);
    expect(label.textContent).toBe('');
    label.scrollWidth = 10;
    render(resolution({ body: 'notice' }));
    expect(icon.hidden).toBe(true);
    expect(label.textContent).toBe('!');
    render(resolution({ bubble: 'song', visible: false }));
    expect(bubble.hidden).toBe(true);
  });
});

describe('animator', () => {
  it('moves the head region while the lower body remains planted', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas(true));
    const frame = resolution({ body: 'idle', overlay: 'headbob', overlayLevel: 1 });
    animator.render(frame, 0);
    animator.render(frame, 100);
    expect(view.recorded.draws.slice(-2)).toEqual([
      [0, 16, 32, 16, 0, 48, 96, 48],
      [0, 0, 32, 16, 0, -12, 96, 48],
    ]);
  });
  it('draws body, outfit, face, accessory in that order with nearest-neighbor scaling', () => {
    rememberSprite('pet.png', pet);
    const { canvas, recorded } = fakeCanvas();
    const animator = createAnimator(canvas, atlas());
    const frame = resolution({
      face: 'content',
      outfit: 'autumn',
      accessory: 'headphones',
    });
    animator.render(frame, 0);
    animator.render(frame, 250);

    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);
    expect(canvas.style.width).toBe('96px');
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(recorded.smoothing).toBe(false);
    expect(recorded.draws).toEqual([
      [0, 0, 32, 32, 0, 0, 96, 96],
      [0, 192, 32, 32, 0, 0, 96, 96],
      [0, 128, 32, 32, 0, 0, 96, 96],
      [32, 224, 32, 32, 0, 0, 96, 96],
      [32, 0, 32, 32, 0, 0, 96, 96],
      [32, 192, 32, 32, 0, 0, 96, 96],
      [0, 128, 32, 32, 0, -3, 96, 96],
      [32, 224, 32, 32, 0, -3, 96, 96],
    ]);
  });

  it('uses an authored overlay frame instead of the star head offset', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    animator.render(resolution({ body: 'walk', face: 'content' }), 0);
    expect(view.recorded.draws).toEqual([
      [0, 32, 32, 32, 0, 0, 96, 96],
      [0, 160, 32, 32, 0, 0, 96, 96],
    ]);
  });

  it('adds headbob offset without drawing a second body', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    const frame = resolution({ body: 'idle', face: 'content', overlay: 'headbob' });
    animator.render(frame, 0);
    // overlayLevel 0 plays headbob at 0.75x, so frame 1 lands at 167ms, not 125ms.
    animator.render(frame, 167);
    expect(view.recorded.draws[2]).toEqual([0, 0, 32, 32, 0, -6, 96, 96]);
    expect(view.recorded.draws[3]).toEqual([0, 128, 32, 32, 0, -6, 96, 96]);
  });

  it('mirrors every layer and the head offset when facing left', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    animator.render(resolution({ body: 'walk', accessory: 'headphones', facing: 'left' }), 0);
    expect(view.recorded.draws).toEqual([
      [0, 32, 32, 32, 0, 0, 96, 96],
      [32, 224, 32, 32, 6, 0, 96, 96],
    ]);
    expect(view.recorded.transforms).toEqual([
      [96, 0],
      [-1, 1],
      [96, 0],
      [-1, 1],
    ]);
    expect(view.recorded.restores).toBe(2);
  });

  it('speeds the overlay with overlayLevel and doubles headbob y at 0.6', () => {
    rememberSprite('pet.png', pet);
    const quiet = fakeCanvas();
    const quietAnimator = createAnimator(quiet.canvas, atlas());
    const quietFrame = resolution({
      body: 'idle',
      face: 'content',
      overlay: 'headbob',
      overlayLevel: 0,
    });
    quietAnimator.render(quietFrame, 0);
    quietAnimator.render(quietFrame, 125);
    expect(quiet.recorded.draws[3]).toEqual([0, 128, 32, 32, 0, 0, 96, 96]);

    const loud = fakeCanvas();
    const loudAnimator = createAnimator(loud.canvas, atlas());
    const loudFrame = resolution({
      body: 'idle',
      face: 'content',
      overlay: 'headbob',
      overlayLevel: 1,
    });
    loudAnimator.render(loudFrame, 0);
    loudAnimator.render(loudFrame, 100);
    expect(loud.recorded.draws[3]).toEqual([0, 128, 32, 32, 0, -12, 96, 96]);
  });

  it('advances faster when mood speed is above 1 and holds a one-shot on the last frame', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    const idle = resolution({ speed: 2 });
    animator.render(idle, 0);
    animator.render(idle, 125);
    expect(view.recorded.draws[1]?.[0]).toBe(32);

    const jump = resolution({ body: 'jump' });
    animator.render(jump, 200);
    animator.render(jump, 10_200);
    const last = view.recorded.draws.at(-1);
    expect(last?.[0]).toBe(96);
    expect(last?.[1]).toBe(96);
  });

  it('clears and restarts after the pet is hidden', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    animator.render(resolution({ visible: false }), 0);
    expect(view.recorded.draws).toEqual([]);
    expect(view.recorded.clears).toBe(1);
    animator.render(resolution(), 5000);
    expect(view.recorded.draws).toEqual([[0, 0, 32, 32, 0, 0, 96, 96]]);
  });

  it('finishes a one-shot before its engine deadline even with sleepy speed', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    const frame = resolution({ body: 'jump', speed: 0.7 });
    animator.render(frame, 0);
    animator.render(frame, 999);
    expect(view.recorded.draws.at(-1)?.[0]).toBe(96);
  });

  it('keeps authored overlays attached to the body during music bobbing', () => {
    rememberSprite('pet.png', pet);
    const view = fakeCanvas();
    const animator = createAnimator(view.canvas, atlas());
    const frame = resolution({
      body: 'walk',
      face: 'content',
      overlay: 'headbob',
      overlayLevel: 1,
    });
    animator.render(frame, 0);
    animator.render(frame, 100);
    expect(view.recorded.draws.slice(-2).map((draw) => draw[5])).toEqual([-12, -12]);
  });

  it('logs a missing overlay once and skips a missing bitmap', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const view = fakeCanvas();
      const animator = createAnimator(view.canvas, atlas());
      const frame = resolution({ face: 'energetic' });
      animator.render(frame, 0);
      animator.render(frame, 100);
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0]?.[0]).toBe('missing overlay face/energetic/idle');
      expect(view.recorded.draws).toHaveLength(2);

      const bare = mergeAtlases([
        {
          version: 1,
          group: 'base',
          frame: { w: 32, h: 32 },
          sheets: [
            {
              layer: 'body',
              image: 'gone.png',
              animations: {
                idle: anim({ row: 0, start: 0, count: 1, fps: 4, loop: true }),
              },
            },
          ],
        },
      ]);
      const empty = fakeCanvas();
      createAnimator(empty.canvas, bare).render(resolution(), 0);
      expect(empty.recorded.draws).toEqual([]);
      expect(debug).toHaveBeenCalledTimes(2);
    } finally {
      debug.mockRestore();
    }
  });

  it('throws when the canvas has no 2d context', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createAnimator(canvas, atlas())).toThrow(/2d/);
  });
});
