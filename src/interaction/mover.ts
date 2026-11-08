import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type { Bridge } from '../bridge';

export interface Mover {
  startDragging(): Promise<void>;
}

export interface MoverOptions {
  waitForRelease?: () => Promise<void>;
  startDragging?: () => Promise<void>;
}

/** Windows owns the drag loop, cursor capture, and monitor/DPI transitions. */
export function createMover(bridge: Bridge, options: MoverOptions = {}): Mover {
  const drag =
    options.startDragging ??
    (() => (bridge.kind === 'tauri' ? getCurrentWindow().startDragging() : Promise.resolve()));
  const waitForRelease =
    options.waitForRelease ??
    (() => (bridge.kind === 'tauri' ? invoke<void>('wait_for_drag_release') : Promise.resolve()));
  let pending: Promise<void> | null = null;
  return {
    startDragging() {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(drag)
        .then(waitForRelease)
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
