import type { Animation, Facing, LayerName, Resolution } from '../behavior/types';
import { type AnimationDef, type MergedAtlas, spriteSource } from './atlas';

const CSS_PX = 96;
const NO_SHIFT: readonly [number, number] = [0, 0];

/** Atlas z-order. `LAYERS` lists face before outfit, which is not the draw order. */
const DRAW_ORDER = ['body', 'outfit', 'face', 'accessory'] as const satisfies readonly LayerName[];

export interface Animator {
  render(resolution: Resolution, now: number): void;
}

/** Text stays outside the mirrored pixel canvas and never interprets track titles as HTML. */
export function createSpeechBubble(canvas: HTMLCanvasElement): (resolution: Resolution) => void {
  canvas.style.position = 'absolute';
  canvas.style.left = '32px';
  canvas.style.top = '40px';
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.removeAttribute('title');
  const bubble = canvas.ownerDocument.createElement('div');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  bubble.style.cssText = [
    'position:absolute',
    'top:2px',
    'left:4px',
    'width:152px',
    'box-sizing:border-box',
    'padding:5px 9px',
    'border:2px solid #493747',
    'border-radius:16px',
    'box-shadow:0 3px 0 #cbb8a0',
    'background:#fff8e9',
    'color:#49372f',
    'font:600 12px/16px "Segoe UI",sans-serif',
    'text-align:center',
    'overflow:hidden',
    'white-space:nowrap',
    'text-overflow:ellipsis',
    'pointer-events:none',
  ].join(';');
  const icon = canvas.ownerDocument.createElement('span');
  icon.textContent = '♫';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.cssText = 'flex:none;font-size:16px;margin-right:5px';
  const viewport = canvas.ownerDocument.createElement('span');
  viewport.style.cssText = 'display:block;min-width:0;overflow:hidden';
  const label = canvas.ownerDocument.createElement('span');
  label.style.cssText = 'display:inline-block;white-space:nowrap';
  viewport.append(label);
  bubble.append(icon, viewport);
  bubble.style.alignItems = 'center';
  bubble.style.justifyContent = 'center';
  let previous: string | null = null;
  let scrolling: globalThis.Animation | null = null;
  bubble.hidden = true;
  canvas.after(bubble);
  return (resolution) => {
    const text = resolution.visible
      ? (resolution.bubble ?? (resolution.body === 'notice' ? '!' : null))
      : null;
    canvas.style.cursor = resolution.body === 'walk' ? 'grabbing' : 'grab';
    bubble.hidden = !text;
    bubble.style.display = text ? 'flex' : 'none';
    if (text === previous) return;
    previous = text;
    scrolling?.cancel();
    scrolling = null;
    label.textContent = text ?? '';
    icon.hidden = !resolution.bubble;
    bubble.setAttribute('aria-label', resolution.bubble ? `Music: ${text}` : (text ?? ''));
    const overflow = Math.max(0, label.scrollWidth - viewport.clientWidth);
    if (text && overflow > 0) {
      scrolling = label.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: 0.15 },
          { transform: `translateX(-${overflow}px)`, offset: 0.85 },
          { transform: `translateX(-${overflow}px)`, offset: 1 },
        ],
        { duration: 2800, iterations: Infinity, direction: 'alternate' },
      );
    }
  };
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

function backingScale(frame: number): number {
  const candidate = (globalThis as { devicePixelRatio?: unknown }).devicePixelRatio;
  const dpr = typeof candidate === 'number' && candidate > 0 ? candidate : 1;
  // Fractional display scaling can make a source pixel fractional. Round so
  // drawImage destinations stay on whole pixels.
  return Math.max(1, Math.round((CSS_PX / frame) * dpr));
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

function prepare(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, frame: number): number {
  const scale = backingScale(frame);
  const size = frame * scale;
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
  facing: Facing,
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
  const frameSize = def.frameSize ?? 32;
  const size = frameSize * scale;
  const left = shift[0] * scale;
  const top = shift[1] * scale;
  // drawImage with negative width moves the rectangle; only a transform mirrors pixels.
  ctx.save();
  if (facing === 'left') {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  const split = def.motionSplit;
  if (split !== undefined && (left !== 0 || top !== 0)) {
    // Draw the planted lower region first; the articulated head overlaps the neck.
    if (split < frameSize)
      ctx.drawImage(
        image,
        (def.start + index) * frameSize,
        def.row * frameSize + split,
        frameSize,
        frameSize - split,
        0,
        split * scale,
        size,
        (frameSize - split) * scale,
      );
    if (split > 0)
      ctx.drawImage(
        image,
        (def.start + index) * frameSize,
        def.row * frameSize,
        frameSize,
        split,
        left,
        top,
        size,
        split * scale,
      );
  } else {
    ctx.drawImage(
      image,
      (def.start + index) * frameSize,
      def.row * frameSize,
      frameSize,
      frameSize,
      left,
      top,
      size,
      size,
    );
  }
  ctx.restore();
}

function paintOverlay(
  ctx: CanvasRenderingContext2D,
  atlas: MergedAtlas,
  layer: 'outfit' | 'face' | 'accessory',
  variant: string,
  bodyAnim: Animation,
  bodyFrame: number,
  head: readonly [number, number],
  bob: readonly [number, number],
  scale: number,
  facing: Facing,
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
  paint(
    ctx,
    def,
    authored ? bodyFrame : 0,
    authored ? bob : addShift(head, bob),
    scale,
    facing,
    missing,
  );
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
      const scale = prepare(canvas, ctx, atlas.frameSize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!resolution.visible) {
        bodyPlayback = null;
        overlayPlayback = null;
        return;
      }

      const bodyAnim: Animation = resolution.body ?? 'idle';
      const bodyDef = atlas.body(bodyAnim);
      // One-shots have fixed engine deadlines; slowing them truncates the final poses.
      bodyPlayback = track(bodyPlayback, bodyAnim, now, bodyDef.loop ? resolution.speed : 1);
      const bodyFrame = frameIndex(bodyDef, bodyPlayback.elapsed, 1);
      const head = shiftOf(bodyDef, bodyFrame);
      let bobOffset = NO_SHIFT;
      // headbob rides on top of the body animation: only its headOffset is applied,
      // so an activity pose is not replaced by a second body.
      if (resolution.overlay && resolution.overlay !== bodyAnim) {
        const overlaySpeed = resolution.speed * (0.75 + 0.5 * resolution.overlayLevel);
        overlayPlayback = track(overlayPlayback, resolution.overlay, now, overlaySpeed);
        const bob = atlas.body(resolution.overlay);
        const bobFrame = frameIndex(bob, overlayPlayback.elapsed, 1);
        const bobShift = shiftOf(bob, bobFrame);
        const bobY = resolution.overlayLevel >= 0.6 ? bobShift[1] * 2 : bobShift[1];
        const working = ['code', 'think', 'write', 'browse'].includes(bodyAnim);
        // Work sprites already articulate the head: add only a small musical nod.
        bobOffset = working ? [Math.sign(bobShift[0]), Math.sign(bobY)] : [bobShift[0], bobY];
      } else {
        overlayPlayback = null;
      }

      for (const layer of DRAW_ORDER) {
        if (layer === 'body') {
          paint(ctx, bodyDef, bodyFrame, bobOffset, scale, resolution.facing, missing);
          continue;
        }
        const variant = variantFor(layer, resolution);
        if (!variant) continue;
        paintOverlay(
          ctx,
          atlas,
          layer,
          variant,
          bodyAnim,
          bodyFrame,
          head,
          bobOffset,
          scale,
          resolution.facing,
          missing,
        );
      }
    },
  };
}
