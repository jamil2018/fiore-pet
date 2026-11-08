import type { Bridge } from '../bridge';
import { EVENT_TYPES, type EventType, type FioreEvent, parseFioreEvent } from '../events';

/** Payload samples the panel fills in. Values match the golden fixtures, except the baseline snapshot. */
const SAMPLE_PAYLOADS: Record<EventType, object> = {
  'state.snapshot': {
    activity: 'other',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: { playing: false },
  },
  'fullscreen.entered': {},
  'fullscreen.exited': {},
  'pet.drag_start': {},

  'pet.drag_end': {},

  'pet.hover_start': {},
  'pet.stroke': { direction: 'left' },
  'pet.petted': {},
  'pet.hover_end': { wasPetted: true },
  'app.category_changed': { category: 'coding', process: 'Code.exe', title: 'main.rs' },
  'music.started': { title: 'Song', artist: 'Artist', sourceApp: 'Spotify.exe' },
  'music.level': { peak: 0.5 },
  'music.track_changed': { title: 'Other', artist: 'Artist' },
  'music.stopped': {},
  'time.mood_changed': { mood: 'sleepy' },
  'season.changed': { season: 'winter' },
};

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export function debugEvent(type: string, payloadJson: string): FioreEvent | null {
  if (!isEventType(type)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
  return parseFioreEvent({ type, payload });
}

function sampleJson(type: EventType): string {
  return JSON.stringify(SAMPLE_PAYLOADS[type], null, 2);
}

/**
 * Visible only in the browser mock. The pet window is the sprite, so a panel
 * there would cover it; Tauri dev injects through `scripts/dev/emit-event.mjs`.
 */
export function mountDebugPanel(bridge: Bridge): void {
  if (bridge.kind !== 'mock' || typeof document === 'undefined') return;

  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';

  const root = document.createElement('div');
  root.id = 'fiore-debug';
  root.style.position = 'fixed';
  root.style.left = '8px';
  root.style.bottom = '8px';
  root.style.zIndex = '10';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '4px';
  root.style.padding = '8px';
  root.style.width = '280px';
  root.style.background = '#14120b';
  root.style.color = '#f4f0e6';
  root.style.font = '12px/1.3 ui-sans-serif, sans-serif';

  const label = document.createElement('label');
  label.textContent = 'Event';
  label.htmlFor = 'fiore-debug-event';

  const select = document.createElement('select');
  select.id = 'fiore-debug-event';
  for (const type of EVENT_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.append(option);
  }

  const payload = document.createElement('textarea');
  payload.rows = 6;
  payload.spellcheck = false;
  payload.style.font = '12px/1.3 ui-monospace, monospace';
  payload.style.color = '#14120b';

  const fire = document.createElement('button');
  fire.type = 'button';
  fire.textContent = 'Fire';

  const status = document.createElement('p');
  status.style.margin = '0';

  const fill = (): void => {
    if (!isEventType(select.value)) return;
    payload.value = sampleJson(select.value);
    status.textContent = '';
  };
  select.addEventListener('change', fill);
  fill();

  fire.addEventListener('click', () => {
    const event = debugEvent(select.value, payload.value);
    if (!event) {
      status.textContent = 'invalid event';
      return;
    }
    status.textContent = event.type;
    void bridge.emitDebug(event);
  });

  root.append(label, select, payload, fire, status);
  document.body.append(root);
}
