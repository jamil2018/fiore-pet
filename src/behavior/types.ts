import type { Category, FioreEvent, Mood, MusicState, Season } from '../events';

export const ANIMATIONS = [
  'idle',
  'walk',
  'sit',
  'notice',
  'dance',
  'headbob',
  'jump',
  'code',
  'think',
  'write',
  'browse',
  'lean',
  'happy',
  'wag',
  'hide',
  'appear',
  'stretch',
  'yawn',
  'twirl',
] as const;
export type Animation = (typeof ANIMATIONS)[number];

export const ONE_SHOTS = [
  'notice',
  'jump',
  'stretch',
  'yawn',
  'twirl',
  'appear',
  'hide',
  'wag',
] as const satisfies readonly Animation[];
export type OneShot = (typeof ONE_SHOTS)[number];

export const LAYERS = ['body', 'face', 'outfit', 'accessory'] as const;
export type LayerName = (typeof LAYERS)[number];

export const FACES = ['energetic', 'content', 'calm', 'sleepy', 'happy'] as const;
export type FaceName = (typeof FACES)[number];

export const OUTFITS = ['winter', 'spring', 'summer', 'autumn', 'summer_glasses'] as const;
export type OutfitName = (typeof OUTFITS)[number];

export const ACCESSORIES = ['headphones', 'laptop', 'notepad', 'tablet'] as const;
export type AccessoryName = (typeof ACCESSORIES)[number];

export const OVERLAYS = ['headbob'] as const satisfies readonly Animation[];
export type OverlayName = (typeof OVERLAYS)[number];

export const TIERS = ['hidden', 'petting', 'oneShot', 'activity', 'music', 'idle'] as const;
export type Tier = (typeof TIERS)[number];

export const FEATURES = ['fullscreen', 'petting', 'activity', 'music', 'mood', 'season'] as const;
export type FeatureId = (typeof FEATURES)[number];

export type Facing = 'left' | 'right';

export interface World {
  activity: Category;
  mood: Mood;
  season: Season;
  fullscreen: boolean;
  music: MusicState;
  peak: number;
}

export interface Rng {
  next(): number;
}

export interface EngineConfig {
  rng: Rng;
  oneShotMs: Partial<Record<OneShot, number>>;
}

export type EngineInput =
  | { kind: 'event'; event: FioreEvent; now: number }
  | { kind: 'tick'; now: number };

export interface Resolution {
  body: Animation | null;
  face: FaceName | null;
  outfit: OutfitName | null;
  accessory: AccessoryName | null;
  overlay: OverlayName | null;
  speed: number;
  bubble: string | null;
  visible: boolean;
  move: 'stay' | 'wander';
  /** Horizontal mirror. `'right'` when no contribution sets it. */
  facing: Facing;
  /** Overlay playback weight, 0..1. `0` when no contribution sets it. */
  overlayLevel: number;
}

export interface Engine {
  handle(input: EngineInput): Resolution;
}

export interface Contribution {
  tier: Tier;
  body?: Animation;
  face?: FaceName;
  outfit?: OutfitName;
  accessory?: AccessoryName | null;
  overlay?: OverlayName | null;
  speed?: number;
  bubble?: string | null;
  hidden?: boolean;
  facing?: Facing;
  /** 0..1. The resolver keeps the highest-priority value. */
  overlayLevel?: number;
}

export type Effect = { kind: 'oneShot'; animation: OneShot };

export interface ReactionContext {
  now: number;
  rng: Rng;
  world: World;
  config: EngineConfig;
}

export interface Reaction<S> {
  id: FeatureId;
  init(world: World): S;
  reduce(slice: S, event: FioreEvent, ctx: ReactionContext): { slice: S; effects: Effect[] };
  tick(slice: S, ctx: ReactionContext): { slice: S; effects: Effect[] };
  contribute(slice: S, ctx: ReactionContext): Contribution | null;
}

export interface AnyReaction {
  id: FeatureId;
  init(world: World): unknown;
  reduce(
    slice: unknown,
    event: FioreEvent,
    ctx: ReactionContext,
  ): { slice: unknown; effects: Effect[] };
  tick(slice: unknown, ctx: ReactionContext): { slice: unknown; effects: Effect[] };
  contribute(slice: unknown, ctx: ReactionContext): Contribution | null;
}

export function defineReaction<S>(reaction: Reaction<S>): AnyReaction {
  return {
    id: reaction.id,
    init(world) {
      return reaction.init(world);
    },
    reduce(slice, event, ctx) {
      // Registry storage erases S; init wrote this slice.
      return reaction.reduce(slice as S, event, ctx);
    },
    tick(slice, ctx) {
      return reaction.tick(slice as S, ctx);
    },
    contribute(slice, ctx) {
      return reaction.contribute(slice as S, ctx);
    },
  };
}

export function switchEvent<R>(
  event: FioreEvent,
  arms: { [K in FioreEvent['type']]: (event: Extract<FioreEvent, { type: K }>) => R },
): R {
  switch (event.type) {
    case 'state.snapshot':
      return arms['state.snapshot'](event);
    case 'fullscreen.entered':
      return arms['fullscreen.entered'](event);
    case 'fullscreen.exited':
      return arms['fullscreen.exited'](event);
    case 'pet.hover_start':
      return arms['pet.hover_start'](event);
    case 'pet.stroke':
      return arms['pet.stroke'](event);
    case 'pet.petted':
      return arms['pet.petted'](event);
    case 'pet.hover_end':
      return arms['pet.hover_end'](event);
    case 'app.category_changed':
      return arms['app.category_changed'](event);
    case 'music.started':
      return arms['music.started'](event);
    case 'music.level':
      return arms['music.level'](event);
    case 'music.track_changed':
      return arms['music.track_changed'](event);
    case 'music.stopped':
      return arms['music.stopped'](event);
    case 'time.mood_changed':
      return arms['time.mood_changed'](event);
    case 'season.changed':
      return arms['season.changed'](event);
    default: {
      const unexpected: never = event;
      throw new Error(`unhandled fiore event ${JSON.stringify(unexpected)}`);
    }
  }
}
