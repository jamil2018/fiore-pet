import { describe, expect, it } from 'vitest';

import type { Bridge } from '../bridge';
import { debugEvent, mountDebugPanel } from './panel';

describe('debug panel', () => {
  it('builds a catalog event from a payload sample', () => {
    const event = debugEvent('music.level', '{"peak":0.5}');
    expect(event).toEqual({ type: 'music.level', payload: { peak: 0.5 } });
  });

  it('rejects an unknown type and bad json', () => {
    expect(debugEvent('no.such', '{}')).toBeNull();
    expect(debugEvent('music.stopped', '{')).toBeNull();
    expect(debugEvent('music.level', '{"peak":"high"}')).toBeNull();
  });

  it('skips the visible panel outside the browser mock', () => {
    const bridge: Bridge = {
      kind: 'tauri',
      async subscribe() {
        return () => {};
      },
      async ready() {},
      async emitDebug() {},
      window: {
        async show() {},
        async hide() {},
        async setPosition() {},
      },
    };
    mountDebugPanel(bridge);
  });
});
