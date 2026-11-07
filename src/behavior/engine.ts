import type { Category, FioreEvent, Mood } from '../events';
import { REACTIONS } from './reactions';
import {
  type AccessoryName,
  type Animation,
  type AnyReaction,
  type Contribution,
  type Effect,
  type Engine,
  type EngineConfig,
  type EngineInput,
  type FaceName,
  type OneShot,
  type OutfitName,
  type OverlayName,
  type ReactionContext,
  type Resolution,
  switchEvent,
  TIERS,
  type Tier,
  type World,
} from './types';

const DEFAULT_ONE_SHOT_MS: Record<OneShot, number> = {
  notice: 1000,
  jump: 600,
  stretch: 1000,
  yawn: 1000,
  twirl: 1000,
  appear: 1000,
  hide: 1000,
  wag: 800,
};

const MOOD_SPEED: Record<Mood, number> = {
  energetic: 1.2,
  content: 1,
  calm: 0.85,
  sleepy: 0.7,
};

const ACTIVITY_BODY = {
  coding: 'code',
  writing: 'write',
  browsing: 'browse',
  other: 'idle',
} as const satisfies Record<Category, Animation>;

const ACTIVITY_ACCESSORY = {
  coding: 'laptop',
  writing: 'notepad',
  browsing: 'tablet',
  other: null,
} as const satisfies Record<Category, AccessoryName | null>;

/** Jump when `rng.next()` is below this and `peak > 0.8`. */
const JUMP_CHANCE = 0.25;
const HAPPY_MS = 1000;
const AFTERGLOW_MS = 1000;
const BUBBLE_MS = 3000;
const DAY_MS = 86_400_000;
const YAWN_MIN_MS = 120_000;
const YAWN_SPAN_MS = 120_000;

type PetPhase = 'off' | 'hover' | 'stroke' | 'happy' | 'afterglow';

interface ActiveOneShot {
  animation: OneShot;
  until: number;
}

interface Bubble {
  text: string;
  until: number;
}

function tierRank(tier: Tier): number {
  const rank = TIERS.indexOf(tier);
  return rank === -1 ? TIERS.length : rank;
}

function defaultWorld(): World {
  return {
    activity: 'other',
    mood: 'content',
    season: 'autumn',
    fullscreen: false,
    music: { playing: false },
    peak: 0,
  };
}

function foldWorld(world: World, event: FioreEvent): World {
  return switchEvent(event, {
    'state.snapshot': (snapshot) => ({
      activity: snapshot.payload.activity,
      mood: snapshot.payload.mood,
      season: snapshot.payload.season,
      fullscreen: snapshot.payload.fullscreen,
      music: { ...snapshot.payload.music },
      peak: 0,
    }),
    'fullscreen.entered': () => ({ ...world, fullscreen: true }),
    'fullscreen.exited': () => ({ ...world, fullscreen: false }),
    'pet.hover_start': () => world,
    'pet.stroke': () => world,
    'pet.petted': () => world,
    'pet.hover_end': () => world,
    'app.category_changed': (changed) => ({ ...world, activity: changed.payload.category }),
    'music.started': (started) => ({
      ...world,
      music: {
        playing: true,
        title: started.payload.title,
        artist: started.payload.artist,
        sourceApp: started.payload.sourceApp,
      },
    }),
    'music.level': (level) =>
      world.music.playing ? { ...world, peak: level.payload.peak } : world,
    'music.track_changed': (track) => ({
      ...world,
      music: { ...world.music, title: track.payload.title, artist: track.payload.artist },
    }),
    'music.stopped': () => ({ ...world, music: { playing: false }, peak: 0 }),
    'time.mood_changed': (mood) => ({ ...world, mood: mood.payload.mood }),
    'season.changed': (season) => ({ ...world, season: season.payload.season }),
  });
}

function petBody(phase: PetPhase): Animation {
  if (phase === 'stroke') return 'lean';
  if (phase === 'happy' || phase === 'afterglow') return 'happy';
  // Hover has no atlas name. Idle holds the petting tier so activity and music stay underneath.
  return 'idle';
}

export function createEngine(
  config: EngineConfig,
  reactions: readonly AnyReaction[] = REACTIONS,
): Engine {
  let world = defaultWorld();
  const slices: unknown[] = reactions.map((reaction) => reaction.init(world));
  let pet: PetPhase = 'off';
  let petUntil: number | null = null;
  let oneShot: ActiveOneShot | null = null;
  let queue: OneShot[] = [];
  let bubble: Bubble | null = null;
  let twirled = false;
  let lastStretchAt: number | null = null;
  let nextYawnAt: number | null = null;

  function duration(animation: OneShot): number {
    return config.oneShotMs[animation] ?? DEFAULT_ONE_SHOT_MS[animation];
  }

  function yawnDelay(): number {
    return YAWN_MIN_MS + Math.floor(config.rng.next() * (YAWN_SPAN_MS + 1));
  }

  function context(now: number): ReactionContext {
    return { now, rng: config.rng, world, config };
  }

  function resetTransient(): void {
    pet = 'off';
    petUntil = null;
    oneShot = null;
    queue = [];
    bubble = null;
  }

  function syncYawn(previous: Mood, next: Mood, now: number): void {
    if (next !== 'sleepy') {
      nextYawnAt = null;
      return;
    }
    if (previous !== 'sleepy' || nextYawnAt === null) {
      nextYawnAt = now + yawnDelay();
    }
  }

  function expireOneShots(now: number): void {
    while (oneShot && now >= oneShot.until) {
      const next = queue.shift();
      if (!next) {
        oneShot = null;
        return;
      }
      const start = oneShot.until;
      oneShot = { animation: next, until: start + duration(next) };
    }
  }

  function expireBubble(now: number): void {
    if (bubble && now >= bubble.until) bubble = null;
  }

  function advancePet(now: number): void {
    if (pet === 'happy' && petUntil !== null && now >= petUntil) {
      const afterglowUntil = petUntil + AFTERGLOW_MS;
      if (now >= afterglowUntil) {
        pet = 'hover';
        petUntil = null;
      } else {
        pet = 'afterglow';
        petUntil = afterglowUntil;
      }
      return;
    }
    if (pet === 'afterglow' && petUntil !== null && now >= petUntil) {
      pet = 'hover';
      petUntil = null;
    }
  }

  function enqueue(animations: readonly OneShot[], now: number, mode: 'append' | 'replace'): void {
    if (mode === 'replace') {
      oneShot = null;
      queue = [];
    }
    for (const animation of animations) {
      if (!oneShot) {
        oneShot = { animation, until: now + duration(animation) };
      } else {
        queue.push(animation);
      }
    }
  }

  function jumpQueued(): boolean {
    return oneShot?.animation === 'jump' || queue.includes('jump');
  }

  function applyPet(event: FioreEvent, now: number): void {
    if (world.fullscreen) return;
    switch (event.type) {
      case 'pet.hover_start':
        if (pet === 'off') pet = 'hover';
        break;
      case 'pet.stroke':
        if (pet === 'hover' || pet === 'stroke') pet = 'stroke';
        break;
      case 'pet.petted':
        pet = 'happy';
        petUntil = now + HAPPY_MS;
        break;
      case 'pet.hover_end':
        pet = 'off';
        petUntil = null;
        break;
      default:
        break;
    }
  }

  function applyBubble(event: FioreEvent, now: number): void {
    if (event.type === 'music.stopped') {
      bubble = null;
      return;
    }
    if (event.type === 'music.track_changed' && !world.fullscreen) {
      bubble = { text: event.payload.title, until: now + BUBBLE_MS };
    }
  }

  function builtinEventEffects(previous: World, event: FioreEvent, now: number): Effect[] {
    return switchEvent<Effect[]>(event, {
      'state.snapshot': () => [],
      'fullscreen.entered': () => [],
      'fullscreen.exited': () => [],
      'pet.hover_start': () => [],
      'pet.stroke': () => [],
      'pet.petted': () => [],
      'pet.hover_end': (ended) =>
        ended.payload.wasPetted ? [{ kind: 'oneShot', animation: 'wag' }] : [],
      'app.category_changed': () => [],
      'music.started': () => [{ kind: 'oneShot', animation: 'notice' }],
      'music.level': (level) => {
        if (!world.music.playing || !(level.payload.peak > 0.8) || jumpQueued()) return [];
        if (config.rng.next() >= JUMP_CHANCE) return [];
        return [{ kind: 'oneShot', animation: 'jump' }];
      },
      'music.track_changed': () => [{ kind: 'oneShot', animation: 'notice' }],
      'music.stopped': () => [],
      'time.mood_changed': () => {
        if (world.mood !== 'energetic') return [];
        if (lastStretchAt !== null && now - lastStretchAt < DAY_MS) return [];
        lastStretchAt = now;
        return [{ kind: 'oneShot', animation: 'stretch' }];
      },
      'season.changed': () => {
        if (twirled || previous.season === world.season) return [];
        twirled = true;
        return [{ kind: 'oneShot', animation: 'twirl' }];
      },
    });
  }

  function builtinTickEffects(now: number): Effect[] {
    if (world.mood !== 'sleepy' || nextYawnAt === null || now < nextYawnAt) return [];
    nextYawnAt = now + yawnDelay();
    return [{ kind: 'oneShot', animation: 'yawn' }];
  }

  function runReduce(event: FioreEvent, now: number): Effect[] {
    const ctx = context(now);
    const effects: Effect[] = [];
    for (let index = 0; index < reactions.length; index += 1) {
      const reaction = reactions[index];
      if (!reaction) continue;
      const reduced = reaction.reduce(slices[index], event, ctx);
      slices[index] = reduced.slice;
      effects.push(...reduced.effects);
    }
    return effects;
  }

  function runTick(now: number): Effect[] {
    const ctx = context(now);
    const effects: Effect[] = [];
    for (let index = 0; index < reactions.length; index += 1) {
      const reaction = reactions[index];
      if (!reaction) continue;
      const ticked = reaction.tick(slices[index], ctx);
      slices[index] = ticked.slice;
      effects.push(...ticked.effects);
    }
    return effects;
  }

  function playEffects(effects: readonly Effect[], now: number): void {
    if (effects.length === 0) return;
    enqueue(
      effects.map((effect) => effect.animation),
      now,
      'append',
    );
  }

  // A reaction that emits effects owns that step. Stubs emit none, so the engine fills the spec one-shots.
  function effectsForEvent(
    previous: World,
    event: FioreEvent,
    now: number,
    fromReactions: Effect[],
  ): Effect[] {
    if (fromReactions.length > 0) return fromReactions;
    return builtinEventEffects(previous, event, now);
  }

  function effectsForTick(now: number, fromReactions: Effect[]): Effect[] {
    if (fromReactions.length > 0) return fromReactions;
    return builtinTickEffects(now);
  }

  function engineContributions(now: number): Contribution[] {
    const contributions: Contribution[] = [
      {
        tier: 'idle',
        body: 'idle',
        face: world.mood,
        outfit: world.season,
        speed: MOOD_SPEED[world.mood],
      },
    ];
    if (world.activity !== 'other') {
      contributions.push({
        tier: 'activity',
        body: ACTIVITY_BODY[world.activity],
        accessory: ACTIVITY_ACCESSORY[world.activity],
      });
    }
    if (world.music.playing && world.activity === 'other') {
      contributions.push({ tier: 'music', body: 'dance', accessory: 'headphones' });
    } else if (world.music.playing) {
      contributions.push({ tier: 'music', accessory: 'headphones', overlay: 'headbob' });
    }
    if (oneShot) contributions.push({ tier: 'oneShot', body: oneShot.animation });
    if (!world.fullscreen && pet !== 'off') {
      contributions.push({
        tier: 'petting',
        body: petBody(pet),
        ...(pet === 'happy' || pet === 'afterglow' ? { face: 'happy' as const } : {}),
      });
    }
    if (world.fullscreen) contributions.push({ tier: 'hidden', hidden: true });
    if (bubble && now < bubble.until) {
      contributions.push({ tier: 'oneShot', bubble: bubble.text });
    }
    return contributions;
  }

  function resolve(now: number): Resolution {
    const contributions = engineContributions(now);
    const ctx = context(now);
    for (let index = 0; index < reactions.length; index += 1) {
      const reaction = reactions[index];
      if (!reaction) continue;
      const extra = reaction.contribute(slices[index], ctx);
      if (extra) contributions.push(extra);
    }

    let body: Animation | null = null;
    let bodyRank = Number.POSITIVE_INFINITY;
    let face: FaceName = world.mood;
    let faceRank = Number.POSITIVE_INFINITY;
    let outfit: OutfitName = world.season;
    let outfitRank = Number.POSITIVE_INFINITY;
    let speed = MOOD_SPEED[world.mood];
    let speedRank = Number.POSITIVE_INFINITY;
    let overlay: OverlayName | null = null;
    let overlayRank = Number.POSITIVE_INFINITY;
    let bubbleText: string | null = null;
    let bubbleRank = Number.POSITIVE_INFINITY;
    let accessory: AccessoryName | null = null;
    let accessoryRank = Number.POSITIVE_INFINITY;
    let sawAccessory = false;

    for (const contribution of contributions) {
      const rank = tierRank(contribution.tier);
      if (contribution.body !== undefined && rank <= bodyRank) {
        body = contribution.body;
        bodyRank = rank;
      }
      if (contribution.face !== undefined && rank <= faceRank) {
        face = contribution.face;
        faceRank = rank;
      }
      if (contribution.outfit !== undefined && rank <= outfitRank) {
        outfit = contribution.outfit;
        outfitRank = rank;
      }
      if (contribution.speed !== undefined && rank <= speedRank) {
        speed = contribution.speed;
        speedRank = rank;
      }
      if (contribution.overlay !== undefined && rank <= overlayRank) {
        overlay = contribution.overlay;
        overlayRank = rank;
      }
      if (contribution.bubble !== undefined && rank <= bubbleRank) {
        bubbleText = contribution.bubble;
        bubbleRank = rank;
      }
      if (contribution.accessory !== undefined && rank <= accessoryRank) {
        accessory = contribution.accessory;
        accessoryRank = rank;
        sawAccessory = true;
      }
    }

    if (!sawAccessory) accessory = null;
    if (world.music.playing) accessory = 'headphones';
    if (world.activity === 'coding' && outfit === 'summer') outfit = 'summer_glasses';
    if (world.activity !== 'coding' && outfit === 'summer_glasses') outfit = 'summer';
    // One-shots and petting take the body, so the music bob waits. Dance is the whole body.
    if (bodyRank < tierRank('activity') || body === 'dance') overlay = null;

    const transition = oneShot?.animation === 'hide' || oneShot?.animation === 'appear';
    const hidden =
      world.fullscreen || contributions.some((contribution) => contribution.hidden === true);
    let visible = true;
    let move: Resolution['move'] = 'stay';
    if (hidden && !transition) {
      body = null;
      overlay = null;
      bubbleText = null;
      visible = false;
    } else if (
      pet === 'off' &&
      !oneShot &&
      (body === 'idle' || body === 'walk' || body === 'sit')
    ) {
      move = 'wander';
    }

    return { body, face, outfit, accessory, overlay, speed, bubble: bubbleText, visible, move };
  }

  function handleEvent(event: FioreEvent, now: number): Resolution {
    const previous = world;
    world = foldWorld(world, event);
    if (event.type === 'state.snapshot') {
      resetTransient();
      syncYawn(previous.mood, world.mood, now);
      // Snapshot initializes layers and must not play one-shots, even if a reaction emits one.
      runReduce(event, now);
      return resolve(now);
    }

    applyPet(event, now);
    applyBubble(event, now);
    syncYawn(previous.mood, world.mood, now);
    expireOneShots(now);
    advancePet(now);
    expireBubble(now);
    const fromReactions = runReduce(event, now);

    if (event.type === 'fullscreen.entered' && !previous.fullscreen) {
      pet = 'off';
      petUntil = null;
      bubble = null;
      // Hide plays through the hidden tier; it is the transition, then layers go blank.
      enqueue(['hide'], now, 'replace');
    } else if (event.type === 'fullscreen.exited' && previous.fullscreen) {
      enqueue(['appear'], now, 'replace');
    } else if (!world.fullscreen) {
      playEffects(effectsForEvent(previous, event, now, fromReactions), now);
    }

    return resolve(now);
  }

  function handleTick(now: number): Resolution {
    expireOneShots(now);
    advancePet(now);
    expireBubble(now);
    const fromReactions = runTick(now);
    if (!world.fullscreen) playEffects(effectsForTick(now, fromReactions), now);
    return resolve(now);
  }

  return {
    handle(input: EngineInput): Resolution {
      return input.kind === 'event' ? handleEvent(input.event, input.now) : handleTick(input.now);
    },
  };
}
