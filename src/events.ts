export const EVENT_TYPES = [
  'state.snapshot',
  'fullscreen.entered',
  'fullscreen.exited',
  'pet.hover_start',
  'pet.stroke',
  'pet.petted',
  'pet.hover_end',
  'app.category_changed',
  'music.started',
  'music.level',
  'music.track_changed',
  'music.stopped',
  'time.mood_changed',
  'season.changed',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CATEGORIES = ['coding', 'writing', 'browsing', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const MOODS = ['energetic', 'content', 'calm', 'sleepy'] as const;
export type Mood = (typeof MOODS)[number];

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

export const STROKE_DIRECTIONS = ['left', 'right'] as const;
export type StrokeDirection = (typeof STROKE_DIRECTIONS)[number];

export interface MusicState {
  playing: boolean;
  title?: string;
  artist?: string;
  sourceApp?: string;
}

export interface Snapshot {
  activity: Category;
  mood: Mood;
  season: Season;
  fullscreen: boolean;
  music: MusicState;
}

export type FioreEvent =
  | { type: 'state.snapshot'; payload: Snapshot }
  | { type: 'fullscreen.entered'; payload: Record<string, never> }
  | { type: 'fullscreen.exited'; payload: Record<string, never> }
  | { type: 'pet.hover_start'; payload: Record<string, never> }
  | { type: 'pet.stroke'; payload: { direction: StrokeDirection } }
  | { type: 'pet.petted'; payload: Record<string, never> }
  | { type: 'pet.hover_end'; payload: { wasPetted: boolean } }
  | {
      type: 'app.category_changed';
      payload: { category: Category; process: string; title: string };
    }
  | { type: 'music.started'; payload: { title: string; artist: string; sourceApp: string } }
  | { type: 'music.level'; payload: { peak: number } }
  | { type: 'music.track_changed'; payload: { title: string; artist: string } }
  | { type: 'music.stopped'; payload: Record<string, never> }
  | { type: 'time.mood_changed'; payload: { mood: Mood } }
  | { type: 'season.changed'; payload: { season: Season } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return null;
}

function emptyPayload(payload: Record<string, unknown>): Record<string, never> | null {
  return Object.keys(payload).length === 0 ? {} : null;
}

function musicState(value: unknown): MusicState | null {
  if (!isRecord(value) || typeof value.playing !== 'boolean') return null;
  const title = optionalString(value.title);
  const artist = optionalString(value.artist);
  const sourceApp = optionalString(value.sourceApp);
  if (title === null || artist === null || sourceApp === null) return null;
  return {
    playing: value.playing,
    ...(title !== undefined ? { title } : {}),
    ...(artist !== undefined ? { artist } : {}),
    ...(sourceApp !== undefined ? { sourceApp } : {}),
  };
}

export function parseFioreEvent(value: unknown): FioreEvent | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const payload = value.payload;
  switch (value.type) {
    case 'state.snapshot': {
      const music = musicState(payload.music);
      if (
        !oneOf(CATEGORIES, payload.activity) ||
        !oneOf(MOODS, payload.mood) ||
        !oneOf(SEASONS, payload.season) ||
        typeof payload.fullscreen !== 'boolean' ||
        !music
      ) {
        return null;
      }
      return {
        type: 'state.snapshot',
        payload: {
          activity: payload.activity,
          mood: payload.mood,
          season: payload.season,
          fullscreen: payload.fullscreen,
          music,
        },
      };
    }
    case 'fullscreen.entered':
    case 'fullscreen.exited':
    case 'pet.hover_start':
    case 'pet.petted':
    case 'music.stopped': {
      const empty = emptyPayload(payload);
      return empty ? { type: value.type, payload: empty } : null;
    }
    case 'pet.stroke':
      return oneOf(STROKE_DIRECTIONS, payload.direction)
        ? { type: 'pet.stroke', payload: { direction: payload.direction } }
        : null;
    case 'pet.hover_end':
      return typeof payload.wasPetted === 'boolean'
        ? { type: 'pet.hover_end', payload: { wasPetted: payload.wasPetted } }
        : null;
    case 'app.category_changed':
      return oneOf(CATEGORIES, payload.category) &&
        typeof payload.process === 'string' &&
        typeof payload.title === 'string'
        ? {
            type: 'app.category_changed',
            payload: {
              category: payload.category,
              process: payload.process,
              title: payload.title,
            },
          }
        : null;
    case 'music.started':
      return typeof payload.title === 'string' &&
        typeof payload.artist === 'string' &&
        typeof payload.sourceApp === 'string'
        ? {
            type: 'music.started',
            payload: {
              title: payload.title,
              artist: payload.artist,
              sourceApp: payload.sourceApp,
            },
          }
        : null;
    case 'music.level':
      return typeof payload.peak === 'number' && Number.isFinite(payload.peak)
        ? { type: 'music.level', payload: { peak: payload.peak } }
        : null;
    case 'music.track_changed':
      return typeof payload.title === 'string' && typeof payload.artist === 'string'
        ? {
            type: 'music.track_changed',
            payload: { title: payload.title, artist: payload.artist },
          }
        : null;
    case 'time.mood_changed':
      return oneOf(MOODS, payload.mood)
        ? { type: 'time.mood_changed', payload: { mood: payload.mood } }
        : null;
    case 'season.changed':
      return oneOf(SEASONS, payload.season)
        ? { type: 'season.changed', payload: { season: payload.season } }
        : null;
    default:
      return null;
  }
}
