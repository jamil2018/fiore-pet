import type { Bridge } from './index';

export function createMockBridge(): Bridge {
  return {
    kind: 'mock',
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
}
