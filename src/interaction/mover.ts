import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';

import type { Resolution } from '../behavior/types';
import type { Bridge } from '../bridge';

export interface Point {
  x: number;
  y: number;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Pet window from `tauri.conf.json`: 96px sprite plus bubble margin. */
export const PET_WINDOW: Size = { width: 160, height: 136 };

export const WANDER_STEP_PX = 12;
export const WANDER_INTERVAL_MS = 400;

const FALLBACK_AREA: Area = { x: 0, y: 0, width: 1920, height: 1080 };

export interface Mover {
  apply(resolution: Resolution): void;
}

export interface WanderState {
  position: Point;
  target: Point | null;
}

export interface WanderMath {
  area: Area;
  windowSize: Size;
  stepPx: number;
  rng: () => number;
}

type Cancel = () => void;

export interface MoverOptions {
  rng?: () => number;
  workArea?: () => Promise<Area>;
  position?: () => Promise<Point>;
  setPosition?: (x: number, y: number) => Promise<void>;
  schedule?: (callback: () => void, delayMs: number) => Cancel;
  stepPx?: number;
  intervalMs?: number;
  windowSize?: Size;
}

/** One wander step in logical pixels. `target` is kept until the pet arrives, then replaced. */
export function advanceWander(state: WanderState, math: WanderMath): WanderState {
  const arrived = state.target !== null && distance(state.position, state.target) <= math.stepPx;
  const target =
    arrived || state.target === null
      ? pickTarget(math.area, math.windowSize, math.rng)
      : state.target;
  const stepped = stepToward(state.position, target, math.stepPx);
  const rounded = { x: Math.round(stepped.x), y: Math.round(stepped.y) };
  return {
    position: clampPoint(rounded, math.area, math.windowSize),
    target,
  };
}

export function pickTarget(area: Area, windowSize: Size, rng: () => number): Point {
  const spanX = Math.max(0, area.width - windowSize.width);
  const spanY = Math.max(0, area.height - windowSize.height);
  return {
    x: area.x + Math.round(unit(rng()) * spanX),
    y: area.y + Math.round(unit(rng()) * spanY),
  };
}

export function stepToward(from: Point, to: Point, stepPx: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || stepPx <= 0) return { x: from.x, y: from.y };
  if (dist <= stepPx) return { x: to.x, y: to.y };
  const scale = stepPx / dist;
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

export function clampPoint(point: Point, area: Area, windowSize: Size): Point {
  const maxX = area.x + area.width - windowSize.width;
  const maxY = area.y + area.height - windowSize.height;
  return {
    x: clamp(point.x, area.x, maxX),
    y: clamp(point.y, area.y, maxY),
  };
}

export function createMover(bridge: Bridge, options: MoverOptions = {}): Mover {
  const rng = options.rng ?? Math.random;
  const stepPx = options.stepPx ?? WANDER_STEP_PX;
  const intervalMs = options.intervalMs ?? WANDER_INTERVAL_MS;
  const readArea = options.workArea ?? (() => readWorkArea(bridge));
  const readPosition = options.position ?? (() => readWindowPosition(bridge));
  const writePosition = options.setPosition ?? ((x, y) => bridge.window.setPosition(x, y));
  const schedule = options.schedule ?? defaultSchedule;

  let active = false;
  let stepping = false;
  let timer: Cancel | null = null;
  let chain: Promise<void> = Promise.resolve();
  let position: Point | null = null;
  let target: Point | null = null;
  let windowSize: Size | null = options.windowSize ?? null;

  function cancelTimer(): void {
    timer?.();
    timer = null;
  }

  function arm(): void {
    if (!active || timer || stepping) return;
    timer = schedule(() => {
      timer = null;
      void runStep();
    }, intervalMs);
  }

  function runStep(): void {
    if (!active || stepping) return;
    stepping = true;
    chain = chain
      .then(() => step())
      .catch((error: unknown) => {
        console.debug('wander step failed', error);
      })
      .then(() => {
        stepping = false;
        arm();
      });
  }

  async function step(): Promise<void> {
    if (!active) return;
    const area = await readArea();
    if (!active) return;
    if (position === null) {
      position = await readPosition();
      if (!active) return;
    }
    const size = await currentWindowSize();
    if (!active) return;
    const next = advanceWander({ position, target }, { area, windowSize: size, stepPx, rng });
    target = next.target;
    if (next.position.x === position.x && next.position.y === position.y) return;
    // Logical pixels, rounded before setPosition (sprite-atlas.md).
    await writePosition(next.position.x, next.position.y);
    position = next.position;
  }

  async function currentWindowSize(): Promise<Size> {
    if (windowSize) return windowSize;
    windowSize = await readWindowSize(bridge);
    return windowSize;
  }

  return {
    apply(resolution) {
      switch (resolution.move) {
        case 'stay':
          active = false;
          cancelTimer();
          return;
        case 'wander':
          active = true;
          arm();
          return;
        default: {
          const unreachable: never = resolution.move;
          return unreachable;
        }
      }
    },
  };
}

function defaultSchedule(callback: () => void, delayMs: number): Cancel {
  const id = setTimeout(callback, delayMs);
  return () => clearTimeout(id);
}

async function readWorkArea(bridge: Bridge): Promise<Area> {
  if (bridge.kind !== 'tauri') return FALLBACK_AREA;
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor || !Number.isFinite(monitor.scaleFactor) || monitor.scaleFactor <= 0) {
    return FALLBACK_AREA;
  }
  const origin = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
  return {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: Math.max(0, Math.round(size.width)),
    height: Math.max(0, Math.round(size.height)),
  };
}

async function readWindowPosition(bridge: Bridge): Promise<Point> {
  if (bridge.kind !== 'tauri') return { x: 0, y: 0 };
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  if (!Number.isFinite(scale) || scale <= 0) return { x: 0, y: 0 };
  const logical = (await win.outerPosition()).toLogical(scale);
  return { x: Math.round(logical.x), y: Math.round(logical.y) };
}

async function readWindowSize(bridge: Bridge): Promise<Size> {
  if (bridge.kind !== 'tauri') return PET_WINDOW;
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  if (!Number.isFinite(scale) || scale <= 0) return PET_WINDOW;
  const logical = (await win.outerSize()).toLogical(scale);
  const width = Math.round(logical.width);
  const height = Math.round(logical.height);
  if (width <= 0 || height <= 0) return PET_WINDOW;
  return { width, height };
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function unit(roll: number): number {
  if (!Number.isFinite(roll)) return 0;
  return Math.min(1, Math.max(0, roll));
}

function clamp(value: number, origin: number, far: number): number {
  const min = Math.min(origin, far);
  const max = Math.max(origin, far);
  return Math.min(max, Math.max(min, value));
}
