import { createEngine } from './behavior/engine';
import type { Resolution, Rng } from './behavior/types';
import { selectBridge } from './bridge';
import { createMover } from './interaction/mover';
import { createPettingDetector } from './interaction/petting';
import { createAnimator } from './render/animator';
import { browserImageLoader, loadAtlases, SPRITE_GROUPS } from './render/atlas';

/** ~15 fps. One-shots and speech bubbles advance without a 60 Hz loop. */
const FRAME_MS = 1000 / 15;

const rng: Rng = { next: () => Math.random() };

async function main(): Promise<void> {
  const canvas = document.querySelector('#pet');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('missing #pet canvas');
  }
  const bridge = selectBridge();
  const atlas = await loadAtlases({
    groups: SPRITE_GROUPS,
    log: (message) => {
      console.debug(message);
    },
    fetchJson: async (group) => {
      const response = await fetch(`/sprites/${group}.json`);
      if (!response.ok) throw new Error(`missing ${group}`);
      return response.json() as Promise<unknown>;
    },
    loadImage: (src) => browserImageLoader(`/sprites/${src}`),
  });
  const engine = createEngine({ rng, oneShotMs: {} });
  const animator = createAnimator(canvas, atlas);
  const mover = createMover(bridge);

  let timer: number | null = null;
  let windowVisible: boolean | null = null;
  let visibilityChain: Promise<void> = Promise.resolve();

  function stopLoop(): void {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  }

  function scheduleLoop(): void {
    if (timer !== null) return;
    timer = window.setTimeout(onFrame, FRAME_MS);
  }

  function syncWindow(visible: boolean): void {
    if (windowVisible === visible) return;
    windowVisible = visible;
    visibilityChain = visibilityChain
      .then(() => (visible ? bridge.window.show() : bridge.window.hide()))
      .catch((error: unknown) => {
        if (windowVisible === visible) windowVisible = null;
        console.debug('window visibility change failed', error);
      });
  }

  function present(resolution: Resolution, now: number): void {
    animator.render(resolution, now);
    mover.apply(resolution);
    syncWindow(resolution.visible);
    if (resolution.visible) scheduleLoop();
    else stopLoop();
  }

  function onFrame(): void {
    timer = null;
    const now = performance.now();
    present(engine.handle({ kind: 'tick', now }), now);
  }

  createPettingDetector(canvas, (event) => {
    const now = performance.now();
    present(engine.handle({ kind: 'event', event, now }), now);
  });

  await bridge.subscribe((event) => {
    const now = performance.now();
    present(engine.handle({ kind: 'event', event, now }), now);
  });
  await bridge.ready();
  const now = performance.now();
  present(engine.handle({ kind: 'tick', now }), now);
  await visibilityChain;
  if (import.meta.env.DEV) {
    const panel = await import('./debug/panel');
    panel.mountDebugPanel(bridge);
  }
}

void main();
