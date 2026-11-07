import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { type FioreEvent, parseFioreEvent } from '../events';
import type { Bridge } from './index';

export function createTauriBridge(): Bridge {
  const window = getCurrentWindow();
  return {
    kind: 'tauri',
    async subscribe(handler) {
      return listen('fiore://event', (message) => {
        const event = parseFioreEvent(message.payload);
        if (!event) {
          console.debug('dropped invalid fiore event');
          return;
        }
        handler(event);
      });
    },
    async ready() {
      await invoke('frontend_ready');
    },
    async emitDebug(event: FioreEvent) {
      await invoke('emit_debug_event', { event });
    },
    window: {
      async show() {
        await window.show();
      },
      async hide() {
        await window.hide();
      },
      async setPosition(x, y) {
        await window.setPosition(new LogicalPosition(x, y));
      },
    },
  };
}
