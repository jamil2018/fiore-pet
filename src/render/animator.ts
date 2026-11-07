import type { Animation, LayerName, Resolution } from '../behavior/types';
import { type AnimationDef, type MergedAtlas, spriteSource } from './atlas';

const FRAME = 32;
const SPRITE_SCALE = 3;
const CSS_PX = FRAME * SPRITE_SCALE;
const NO_SHIFT: readonly [number, number] = [0, 0];

/** Atlas z-order. `LAYERS` lists face before outfit, which is not the draw order. */
const DRAW_ORDER = ['body', 'outfit', 'face', 'accessory'] as const satisfies readonly LayerName[];

export interface Animator {
  render(resolution: Resolution, now: number): void;
}

interface Playback {
  anim: string;
  lastNow: number;
  elapsed: number;
}

export function frameIndex(def: AnimationDef, elapsedMs: number, speed: number): number {
  if (def.count <= 1 || !(speed > 0) || !(def.fps > 0)) return 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(elapsedMs, 0) : 0;
  const index = Math.floor(elapsed / (1000 / (def.fps * speed)));
  if (!Number.isFinite(index) || index <= 0) return 0;
  if (def.loop) return index % def.count;
  return index >= def.count ? def.count - 1 : index;
}

function backingScale(): number {
  const candidate = (globalThis as { devicePixelRatio?: unknown }).devicePixelRatio;
  const dpr = typeof candidate === 'number' && candidate > 0 ? candidate : 1;
  // 125% and 150% displays make 3 CSS px a fractional device pixel. Round so
  // drawImage destinations stay on whole pixels.
  return Math.max(1, Math.round(SPRITE_SCALE * dpr));
}

function shiftOf(def: AnimationDef, frame: number): readonly [number, number] {
  const pair = def.headOffset?.[frame] ?? NO_SHIFT;
  return [pair[0], pair[1]];
}

function addShift(
  a: readonly [number, number],
  b: readonly [number, number],
): readonly [number, number] {
  return [a[0] + b[0], a[1] + b[1]];
}

function track(current: Playback | null, anim: string, now: number, speed: number): Playback {
  const playback = current?.anim === anim ? current : { anim, lastNow: now, elapsed: 0 };
  const dt = now >= playback.lastNow ? now - playback.lastNow : 0;
  const rate = Number.isFinite(speed) ? Math.max(speed, 0) : 0;
  playback.elapsed += dt * rate;
  playback.lastNow = now;
  return playback;
}

function prepare(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): number {
  const scale = backingScale();
  const size = FRAME * scale;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  canvas.style.width = `${CSS_PX}px`;
  canvas.style.height = `${CSS_PX}px`;
  canvas.style.imageRendering = 'pixelated';
  // Assigning canvas width resets context state, including smoothing.
  ctx.imageSmoothingEnabled = false;
  return scale;
}

function paint(
  ctx: CanvasRenderingContext2D,
  def: AnimationDef,
  frame: number,
  shift: readonly [number, number],
  scale: number,
  missing: Set<string>,
): void {
  const name = def.image;
  const image = name ? spriteSource(name) : undefined;
  if (!image) {
    const key = name ?? 'unknown';
    if (!missing.has(key)) {
      missing.add(key);
      console.debug(`sprite image unavailable: ${key}`);
    }
    return;
  }
  const index = frame >= 0 && frame < def.count ? frame : 0;
  const size = FRAME * scale;
  ctx.drawImage(
    image,
    (def.start + index) * FRAME,
    def.row * FRAME,
    FRAME,
    FRAME,
    shift[0] * scale,
    shift[1] * scale,
    size,
    size,
  );
}

function paintOverlay(
  ctx: CanvasRenderingContext2D,
  atlas: MergedAtlas,
  layer: 'outfit' | 'face' | 'accessory',
  variant: string,
  bodyAnim: Animation,
  bodyFrame: number,
  head: readonly [number, number],
  scale: number,
  missing: Set<string>,
): void {
  const named = atlas.lookup(layer, variant, bodyAnim);
  const star = atlas.lookup(layer, variant, '*');
  const authored = named !== null && named !== star;
  const def = authored ? named : star;
  if (!def) {
    const key = `${layer}/${variant}/${bodyAnim}`;
    if (!missing.has(key)) {
      missing.add(key);
      console.debug(`missing overlay ${key}`);
    }
    return;
  }
  paint(ctx, def, authored ? bodyFrame : 0, authored ? NO_SHIFT : head, scale, missing);
}

function variantFor(layer: (typeof DRAW_ORDER)[number], resolution: Resolution): string | null {
  switch (layer) {
    case 'body':
      return null;
    case 'outfit':
      return resolution.outfit;
    case 'face':
      return resolution.face;
    case 'accessory':
      return resolution.accessory;
    default: {
      const unexpected: never = layer;
      throw new Error(`unexpected layer ${String(unexpected)}`);
    }
  }
}

export function createAnimator(canvas: HTMLCanvasElement, atlas: MergedAtlas): Animator {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  let bodyPlayback: Playback | null = null;
  let overlayPlayback: Playback | null = null;
  const missing = new Set<string>();

  return {
    render(resolution, now) {
      const scale = prepare(canvas, ctx);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!resolution.visible) {
        bodyPlayback = null;
        overlayPlayback = null;
        return;
      }

      const bodyAnim: Animation = resolution.body ?? 'idle';
      bodyPlayback = track(bodyPlayback, bodyAnim, now, resolution.speed);
      const bodyDef = atlas.body(bodyAnim);
      const bodyFrame = frameIndex(bodyDef, bodyPlayback.elapsed, 1);
      let head = shiftOf(bodyDef, bodyFrame);
      // headbob rides on top of the body animation: only its headOffset is applied,
      // so an activity pose is not replaced by a second body.
      if (resolution.overlay && resolution.overlay !== bodyAnim) {
        overlayPlayback = track(overlayPlayback, resolution.overlay, now, resolution.speed);
        const bob = atlas.body(resolution.overlay);
        const bobFrame = frameIndex(bob, overlayPlayback.elapsed, 1);
        head = addShift(head, shiftOf(bob, bobFrame));
      } else {
        overlayPlayback = null;
      }

      for (const layer of DRAW_ORDER) {
        if (layer === 'body') {
          paint(ctx, bodyDef, bodyFrame, NO_SHIFT, scale, missing);
          continue;
        }
        const variant = variantFor(layer, resolution);
        if (!variant) continue;
        paintOverlay(ctx, atlas, layer, variant, bodyAnim, bodyFrame, head, scale, missing);
      }
    },
  };
}
