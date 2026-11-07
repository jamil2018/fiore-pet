import type { FioreEvent } from '../events';

export function createPettingDetector(
  _target: HTMLElement,
  _emit: (event: FioreEvent) => void,
): () => void {
  return () => {};
}
