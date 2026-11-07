import type { Engine, EngineConfig, Resolution } from './types';

const IDLE: Resolution = {
  body: 'idle',
  face: 'content',
  outfit: 'autumn',
  accessory: null,
  overlay: null,
  speed: 1,
  bubble: null,
  visible: true,
  move: 'stay',
};

export function createEngine(_config: EngineConfig): Engine {
  return {
    handle() {
      return { ...IDLE };
    },
  };
}
