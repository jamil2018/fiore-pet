import type { Resolution } from '../behavior/types';
import type { MergedAtlas } from './atlas';

export interface Animator {
  render(resolution: Resolution, now: number): void;
}

export function createAnimator(_canvas: HTMLCanvasElement, _atlas: MergedAtlas): Animator {
  return {
    render() {},
  };
}
