import { ACCESSORIES, ANIMATIONS, FACES, LAYERS, type LayerName, OUTFITS } from '../behavior/types';

export const SPRITE_GROUPS = [
  'base',
  'activity',
  'music',
  'petting',
  'fullscreen',
  'outfits',
  'faces',
] as const;

export type SpriteGroup = (typeof SPRITE_GROUPS)[number];

const FRAME = 32;

export interface AnimationDef {
  row: number;
  start: number;
  count: number;
  fps: number;
  loop: boolean;
  headOffset?: ReadonlyArray<readonly [number, number]>;
  /** Sheet file name, copied on merge so the animator can find the decoded bitmap. */
  image?: string;
  /** Native grid size, supplied by the containing atlas when merged. */
  frameSize?: number;
  /** Pixels above this source row articulate with the music overlay. */
  motionSplit?: number;
}

export interface SheetDef {
  layer: LayerName;
  image: string;
  variant?: string;
  animations: Record<string, AnimationDef>;
}

export interface AtlasFile {
  version: 1;
  group: string;
  frame: { w: 32 | 48; h: 32 | 48 };
  sheets: SheetDef[];
}

export interface ImageSize {
  width: number;
  height: number;
  /** Present when the loader still holds the decoded bitmap. */
  image?: CanvasImageSource;
}

// main.ts measures images and then constructs the animator with only the merged
// metadata, so the bitmap has to stay reachable or the first paint has nothing to draw.
const decodedSprites = new Map<string, CanvasImageSource>();

export function rememberSprite(name: string, source: CanvasImageSource): void {
  decodedSprites.set(name, source);
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (slash >= 0) {
    const base = name.slice(slash + 1);
    if (base.length > 0 && base !== name) decodedSprites.set(base, source);
  }
}

export function spriteSource(name: string): CanvasImageSource | undefined {
  return decodedSprites.get(name);
}

export class AtlasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasError';
  }
}

const KNOWN_ANIMS = new Set<string>([...ANIMATIONS, '*']);
const SYNTHETIC_IDLE: AnimationDef = { row: 0, start: 0, count: 1, fps: 4, loop: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function key(layer: LayerName, variant: string | undefined, anim: string): string {
  return `${layer}\u0000${variant ?? ''}\u0000${anim}`;
}

function assertVariant(layer: LayerName, variant: string | undefined): void {
  if (layer === 'body') {
    if (variant !== undefined) throw new AtlasError('body sheet cannot set variant');
    return;
  }
  if (variant === undefined || variant.length === 0) {
    throw new AtlasError(`${layer} sheet requires variant`);
  }
  const allowed: readonly string[] =
    layer === 'face' ? FACES : layer === 'outfit' ? OUTFITS : ACCESSORIES;
  if (!allowed.includes(variant)) {
    throw new AtlasError(`unknown variant ${variant} for ${layer}`);
  }
}

function assertAnimation(name: string, def: AnimationDef, layer: LayerName): void {
  if (!KNOWN_ANIMS.has(name)) throw new AtlasError(`unknown animation ${name}`);
  if (!Number.isInteger(def.row) || def.row < 0) throw new AtlasError(`bad row for ${name}`);
  if (!Number.isInteger(def.start) || def.start < 0) throw new AtlasError(`bad start for ${name}`);
  if (!Number.isInteger(def.count) || def.count < 1) throw new AtlasError(`bad count for ${name}`);
  if (!Number.isFinite(def.fps) || !(def.fps > 0)) throw new AtlasError(`bad fps for ${name}`);
  if (name === '*' && def.count !== 1) throw new AtlasError('* entry must have count 1');
  if (def.headOffset === undefined) return;
  if (layer !== 'body') throw new AtlasError('headOffset is body only');
  if (def.headOffset.length !== def.count) throw new AtlasError('bad headOffset length');
  for (const pair of def.headOffset) {
    const x = pair[0];
    const y = pair[1];
    if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) {
      throw new AtlasError('bad headOffset');
    }
  }
}

function readAnimation(value: unknown, layer: LayerName, name: string): AnimationDef {
  if (!isRecord(value)) throw new AtlasError(`animation ${name} is not an object`);
  const { row, start, count, fps, loop, headOffset, motionSplit } = value;
  if (
    motionSplit !== undefined &&
    (typeof motionSplit !== 'number' || !Number.isInteger(motionSplit) || motionSplit < 0)
  ) {
    throw new AtlasError('bad motionSplit');
  }
  if (
    typeof row !== 'number' ||
    typeof start !== 'number' ||
    typeof count !== 'number' ||
    typeof fps !== 'number' ||
    typeof loop !== 'boolean'
  ) {
    throw new AtlasError(`animation ${name} has a bad field`);
  }
  let offsets: AnimationDef['headOffset'];
  if (headOffset !== undefined) {
    if (!Array.isArray(headOffset)) throw new AtlasError('bad headOffset');
    offsets = headOffset.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new AtlasError('bad headOffset');
      const x = pair[0];
      const y = pair[1];
      if (typeof x !== 'number' || typeof y !== 'number') throw new AtlasError('bad headOffset');
      return [x, y] as const;
    });
  }
  const def: AnimationDef = {
    row,
    start,
    count,
    fps,
    loop,
    ...(offsets ? { headOffset: offsets } : {}),
    ...(typeof motionSplit === 'number' ? { motionSplit } : {}),
  };
  assertAnimation(name, def, layer);
  return def;
}

export function parseAtlas(json: unknown, group: string): AtlasFile {
  if (!isRecord(json)) throw new AtlasError('atlas is not an object');
  if (json.version !== 1) throw new AtlasError('version !== 1');
  if (json.group !== group)
    throw new AtlasError(`group/file mismatch: ${String(json.group)} != ${group}`);
  if (
    !isRecord(json.frame) ||
    (json.frame.w !== 32 && json.frame.w !== 48) ||
    json.frame.h !== json.frame.w
  ) {
    throw new AtlasError('frame must be 32x32 or 48x48');
  }
  const frameSize = json.frame.w;
  if (!Array.isArray(json.sheets)) throw new AtlasError('sheets must be an array');
  const sheets = json.sheets.map((sheet) => {
    if (!isRecord(sheet)) throw new AtlasError('sheet is not an object');
    if (typeof sheet.layer !== 'string' || !(LAYERS as readonly string[]).includes(sheet.layer)) {
      throw new AtlasError('unknown layer');
    }
    const layer = sheet.layer as LayerName;
    if (typeof sheet.image !== 'string' || sheet.image.length === 0) {
      throw new AtlasError('sheet image is required');
    }
    const variant = sheet.variant === undefined ? undefined : sheet.variant;
    if (variant !== undefined && typeof variant !== 'string')
      throw new AtlasError('variant must be a string');
    assertVariant(layer, variant);
    if (!isRecord(sheet.animations)) throw new AtlasError('animations must be an object');
    const animations: Record<string, AnimationDef> = {};
    for (const [name, value] of Object.entries(sheet.animations)) {
      animations[name] = readAnimation(value, layer, name);
      if ((animations[name]?.motionSplit ?? 0) > frameSize) throw new AtlasError('bad motionSplit');
    }
    const parsed: SheetDef = {
      layer,
      image: sheet.image,
      animations,
      ...(variant !== undefined ? { variant } : {}),
    };
    return parsed;
  });
  return { version: 1, group, frame: { w: frameSize, h: frameSize }, sheets };
}

export function validateImage(sheet: SheetDef, size: ImageSize, frameSize = FRAME): void {
  for (const [name, def] of Object.entries(sheet.animations)) {
    const width = (def.start + def.count) * frameSize;
    const height = (def.row + 1) * frameSize;
    if (size.width < width || size.height < height) {
      throw new AtlasError(`image too small for ${sheet.layer}/${name}`);
    }
  }
}

export class MergedAtlas {
  private fallbackLogged = false;

  constructor(
    private readonly entries: ReadonlyMap<string, AnimationDef>,
    private readonly log: (message: string) => void,
    readonly frameSize: number = FRAME,
  ) {}

  lookup(layer: LayerName, variant: string | undefined, anim: string): AnimationDef | null {
    return (
      this.entries.get(key(layer, variant, anim)) ??
      this.entries.get(key(layer, variant, '*')) ??
      null
    );
  }

  body(anim: string): AnimationDef {
    const found = this.entries.get(key('body', undefined, anim));
    if (found) return found;
    if (!this.fallbackLogged) {
      this.log(`missing body animation ${anim}; using idle`);
      this.fallbackLogged = true;
    }
    return this.entries.get(key('body', undefined, 'idle')) ?? SYNTHETIC_IDLE;
  }
}

export function mergeAtlases(
  files: readonly AtlasFile[],
  log: (message: string) => void = () => {},
): MergedAtlas {
  const entries = new Map<string, AnimationDef>();
  const frameSize = files[0]?.frame.w ?? FRAME;
  for (const file of files) {
    if (file.frame.w !== frameSize || file.frame.h !== frameSize)
      throw new AtlasError('mixed frame sizes');
    for (const sheet of file.sheets) {
      for (const [name, def] of Object.entries(sheet.animations)) {
        const id = key(sheet.layer, sheet.variant, name);
        if (entries.has(id)) {
          throw new AtlasError(`duplicate key ${sheet.layer}/${sheet.variant ?? ''}/${name}`);
        }
        entries.set(id, { ...def, image: sheet.image, frameSize });
      }
    }
  }
  for (const [id, def] of entries) {
    const parts = id.split('\u0000');
    const layer = parts[0];
    const anim = parts[2];
    if (layer === 'body' || anim === '*' || anim === undefined) continue;
    const body = entries.get(key('body', undefined, anim));
    if (body && body.count !== def.count) {
      throw new AtlasError(`count mismatch for ${anim}: body ${body.count}, overlay ${def.count}`);
    }
  }
  return new MergedAtlas(entries, log, frameSize);
}

export interface AtlasLoaders {
  fetchJson: (group: string) => Promise<unknown>;
  loadImage: (src: string) => Promise<ImageSize>;
  log: (message: string) => void;
  groups?: readonly string[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'unavailable';
}

export async function loadAtlases(loaders: AtlasLoaders): Promise<MergedAtlas> {
  const groups = loaders.groups ?? SPRITE_GROUPS;
  const files: AtlasFile[] = [];
  const images = new Map<string, ImageSize>();
  for (const group of groups) {
    let json: unknown;
    try {
      json = await loaders.fetchJson(group);
    } catch (err) {
      loaders.log(`sprite group ${group} skipped: ${errorText(err)}`);
      continue;
    }
    const file = parseAtlas(json, group);
    for (const sheet of file.sheets) {
      let size = images.get(sheet.image);
      if (!size) {
        size = await loaders.loadImage(sheet.image);
        images.set(sheet.image, size);
      }
      validateImage(sheet, size, file.frame.w);
      if (size.image) rememberSprite(sheet.image, size.image);
    }
    files.push(file);
  }
  return mergeAtlases(files, loaders.log);
}

export function browserImageLoader(src: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      rememberSprite(src, image);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, image });
    };
    image.onerror = () => reject(new AtlasError(`image failed: ${src}`));
    image.src = src;
  });
}
