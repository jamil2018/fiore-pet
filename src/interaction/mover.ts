import type { Resolution } from '../behavior/types';
import type { Bridge } from '../bridge';

export interface Mover {
  apply(resolution: Resolution): void;
}

export function createMover(_bridge: Bridge): Mover {
  return {
    apply() {},
  };
}
