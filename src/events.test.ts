import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { switchEvent } from './behavior/types';
import { EVENT_TYPES, parseFioreEvent } from './events';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'behavior/golden/events');

describe('parseFioreEvent', () => {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  it('parses every shared fixture', () => {
    expect(files).toHaveLength(EVENT_TYPES.length);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const event = parseFioreEvent(raw);
      expect(event, file).not.toBeNull();
      if (!event) continue;
      expect(
        switchEvent(event, {
          'state.snapshot': (item) => item.type,
          'fullscreen.entered': (item) => item.type,
          'fullscreen.exited': (item) => item.type,
          'pet.hover_start': (item) => item.type,
          'pet.stroke': (item) => item.type,
          'pet.petted': (item) => item.type,
          'pet.hover_end': (item) => item.type,
          'app.category_changed': (item) => item.type,
          'music.started': (item) => item.type,
          'music.level': (item) => item.type,
          'music.track_changed': (item) => item.type,
          'music.stopped': (item) => item.type,
          'time.mood_changed': (item) => item.type,
          'season.changed': (item) => item.type,
        }),
      ).toBe(event.type);
    }
  });

  it('rejects an unknown type, a missing field, and a wrong enum', () => {
    expect(parseFioreEvent(null)).toBeNull();
    expect(parseFioreEvent({ type: 'no.such', payload: {} })).toBeNull();
    expect(
      parseFioreEvent({
        type: 'state.snapshot',
        payload: {
          activity: 'coding',
          season: 'autumn',
          fullscreen: false,
          music: { playing: false },
        },
      }),
    ).toBeNull();
    expect(parseFioreEvent({ type: 'time.mood_changed', payload: { mood: 'nope' } })).toBeNull();
  });
});
