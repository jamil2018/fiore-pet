import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { ACCESSORIES, FACES, ONE_SHOTS, OUTFITS } from '../behavior/types';
import { createAnimator } from './animator';
import { mergeAtlases, parseAtlas, rememberSprite, SPRITE_GROUPS, validateImage } from './atlas';

const sprites = join(dirname(fileURLToPath(import.meta.url)), '../../public/sprites');

const BODY = [
  'idle',
  'walk',
  'sit',
  'notice',
  'dance',
  'headbob',
  'jump',
  'lean',
  'happy',
  'wag',
  'hide',
  'appear',
  'stretch',
  'yawn',
  'twirl',
] as const;

function readRgba(png: Buffer): { width: number; height: number; pixels: Uint8Array } {
  if (png[0] !== 0x89 || png.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6) throw new Error('expected 8-bit rgba');
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') parts.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error(`unexpected png filter ${raw[row]}`);
    pixels.set(raw.subarray(row + 1, row + 1 + stride), y * stride);
  }
  return { width, height, pixels };
}

function cell(pixels: Uint8Array, width: number, col: number, row: number): Buffer {
  const out = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    const src = ((row * 32 + y) * width + col * 32) * 4;
    out.set(pixels.subarray(src, src + 128), y * 128);
  }
  return out;
}

describe('base atlas', () => {
  const png = readFileSync(join(sprites, 'base.png'));
  const image = readRgba(png);
  const files = SPRITE_GROUPS.map((group) => {
    const json: unknown = JSON.parse(readFileSync(join(sprites, `${group}.json`), 'utf8'));
    return parseAtlas(json, group);
  });
  const merged = mergeAtlases(files);

  it('matches the 32px grid and keeps the pre-split key set without collisions', () => {
    expect(image.width % 32).toBe(0);
    expect(image.height % 32).toBe(0);
    for (const file of files) {
      for (const sheet of file.sheets) {
        expect(sheet.image).toBe('base.png');
        validateImage(sheet, image);
      }
    }
    const baseOnly = mergeAtlases(files.filter((file) => file.group === 'base'));
    for (const name of ['hide', 'appear', 'lean', 'dance', 'stretch', 'twirl']) {
      expect(baseOnly.lookup('body', undefined, name)).toBeNull();
    }
    for (const name of BODY) {
      const def = merged.lookup('body', undefined, name);
      expect(def, name).toBeTruthy();
      if (!def?.headOffset) throw new Error(`missing headOffset for ${name}`);
      expect(def.image).toBe('base.png');
      expect(def.loop).toBe(!(ONE_SHOTS as readonly string[]).includes(name));
      expect(def.headOffset).toHaveLength(def.count);
    }
    for (const name of ['code', 'think', 'write', 'browse']) {
      expect(merged.lookup('body', undefined, name)).toBeNull();
    }
    for (const face of FACES) expect(merged.lookup('face', face, '*')?.count).toBe(1);
    for (const outfit of OUTFITS) expect(merged.lookup('outfit', outfit, '*')?.count).toBe(1);
    for (const accessory of ACCESSORIES) {
      expect(merged.lookup('accessory', accessory, '*')?.count).toBe(1);
    }
  });

  it('uses fully opaque or fully transparent pixels and ends one-shots on idle', () => {
    let opaque = 0;
    for (let i = 3; i < image.pixels.length; i += 4) {
      const alpha = image.pixels[i];
      expect(alpha === 0 || alpha === 255).toBe(true);
      if (alpha === 255) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(100);
    const idle = cell(image.pixels, image.width, 0, 0);
    expect(idle.some((value) => value !== 0)).toBe(true);
    for (const name of BODY) {
      if (!(ONE_SHOTS as readonly string[]).includes(name)) continue;
      const def = merged.body(name);
      const last = cell(image.pixels, image.width, def.count - 1, def.row);
      expect(Buffer.compare(last, idle)).toBe(0);
      expect(def.headOffset?.[def.count - 1]).toEqual([0, 0]);
    }
  });

  it('draws the default idle layers from the base sheet', () => {
    rememberSprite('base.png', {} as CanvasImageSource);
    const draws: number[][] = [];
    let smoothing = true;
    const canvas = {
      width: 0,
      height: 0,
      style: { width: '', height: '', imageRendering: '' },
      getContext() {
        return {
          get imageSmoothingEnabled() {
            return smoothing;
          },
          set imageSmoothingEnabled(value: boolean) {
            smoothing = value;
          },
          clearRect() {},
          drawImage(
            _image: CanvasImageSource,
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            dx: number,
            dy: number,
            dw: number,
            dh: number,
          ) {
            draws.push([sx, sy, sw, sh, dx, dy, dw, dh]);
          },
        };
      },
    };
    createAnimator(canvas as unknown as HTMLCanvasElement, merged).render(
      {
        body: 'idle',
        face: 'content',
        outfit: 'autumn',
        accessory: null,
        overlay: null,
        speed: 1,
        bubble: null,
        visible: true,
        move: 'stay',
        facing: 'right',
        overlayLevel: 0,
      },
      0,
    );
    expect(smoothing).toBe(false);
    expect(canvas.width).toBe(96);
    expect(draws).toHaveLength(3);
    expect(draws.every((draw) => draw[2] === 32 && draw[6] === 96 && draw[4] === 0)).toBe(true);
  });
});
