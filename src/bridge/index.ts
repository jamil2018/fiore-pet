import type { FioreEvent } from '../events';
import { createMockBridge } from './mock';
import { createTauriBridge } from './tauri';

export interface Bridge {
  kind: 'tauri' | 'mock';
  subscribe(handler: (event: FioreEvent) => void): Promise<() => void>;
  ready(): Promise<void>;
  emitDebug(event: FioreEvent): Promise<void>;
  window: {
    show(): Promise<void>;
    hide(): Promise<void>;
    setPosition(x: number, y: number): Promise<void>;
  };
}

export function selectBridge(): Bridge {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (import.meta.env.MODE === 'mock' || !inTauri) return createMockBridge();
  return createTauriBridge();
}
