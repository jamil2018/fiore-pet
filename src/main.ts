import { createEngine } from './behavior/engine';
import type { Rng } from './behavior/types';
import { selectBridge } from './bridge';
import { createMover } from './interaction/mover';
import { createAnimator } from './render/animator';
import { browserImageLoader, loadAtlases, SPRITE_GROUPS } from './render/atlas';

const rng: Rng = { next: () => 0 };

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
  await bridge.subscribe((event) => {
    const now = performance.now();
    const resolution = engine.handle({ kind: 'event', event, now });
    animator.render(resolution, now);
    mover.apply(resolution);
  });
  await bridge.ready();
  const now = performance.now();
  animator.render(engine.handle({ kind: 'tick', now }), now);
  await bridge.window.show();
  if (import.meta.env.DEV) {
    const panel = await import('./debug/panel');
    panel.mountDebugPanel(bridge);
  }
}

void main();
