import { type FioreEvent, parseFioreEvent } from '../events';
import type { Bridge } from './index';

export interface MockBridgeOptions {
  /** Raw event objects. Invalid entries are dropped. Overrides the page script. */
  script?: readonly unknown[];
  /** When false, `ready()` does not emit the hub's baseline snapshot. Default true. */
  snapshot?: boolean;
}

export interface MockCall {
  op: 'show' | 'hide' | 'setPosition';
  x?: number;
  y?: number;
}

/** Same baseline the hub uses before any sensor report. */
const BASELINE: FioreEvent = {
  type: 'state.snapshot',
  payload: {
    activity: 'other',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: { playing: false },
  },
};

const calls = new WeakMap<Bridge, MockCall[]>();

export function mockWindowCalls(bridge: Bridge): readonly MockCall[] {
  return calls.get(bridge) ?? [];
}

function readBrowserScript(): unknown[] {
  if (typeof window === 'undefined') return [];
  const host = window as Window & { __FIORE_MOCK_EVENTS__?: unknown };
  if (Array.isArray(host.__FIORE_MOCK_EVENTS__)) return host.__FIORE_MOCK_EVENTS__;
  const raw = new URLSearchParams(window.location.search).get('events');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    console.debug('dropped invalid mock event script');
    return [];
  }
}

function compile(entries: readonly unknown[]): FioreEvent[] {
  const events: FioreEvent[] = [];
  for (const entry of entries) {
    const event = parseFioreEvent(entry);
    if (event) events.push(event);
    else console.debug('dropped invalid mock event');
  }
  return events;
}

export function createMockBridge(options: MockBridgeOptions = {}): Bridge {
  const handlers = new Set<(event: FioreEvent) => void>();
  const queued: FioreEvent[] = [];
  const script = compile(options.script ?? readBrowserScript());
  const initial: FioreEvent[] = [];
  if (options.snapshot !== false) initial.push(BASELINE);
  initial.push(...script);

  let opened = false;
  const recorded: MockCall[] = [];

  function fanout(event: FioreEvent): void {
    if (handlers.size === 0) {
      queued.push(event);
      return;
    }
    for (const handler of handlers) handler(event);
  }

  function flush(): void {
    const batch = queued.splice(0, queued.length);
    for (const event of batch) {
      for (const handler of handlers) handler(event);
    }
  }

  const bridge: Bridge = {
    kind: 'mock',
    async subscribe(handler) {
      handlers.add(handler);
      flush();
      return () => {
        handlers.delete(handler);
      };
    },
    async ready() {
      if (opened) return;
      opened = true;
      for (const event of initial) fanout(event);
    },
    async emitDebug(event) {
      fanout(event);
    },
    window: {
      async show() {
        recorded.push({ op: 'show' });
      },
      async hide() {
        recorded.push({ op: 'hide' });
      },
      async setPosition(x, y) {
        recorded.push({ op: 'setPosition', x, y });
      },
    },
  };
  calls.set(bridge, recorded);
  return bridge;
}
