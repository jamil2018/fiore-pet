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

const ACTIVITY_BODY = ['code', 'think', 'write', 'browse'] as const;

const sheetImages = new Map<string, { width: number; height: number; pixels: Uint8Array }>();

function sheetImage(name: string) {
  const cached = sheetImages.get(name);
  if (cached) return cached;
  const decoded = readRgba(readFileSync(join(sprites, name)));
  sheetImages.set(name, decoded);
  return decoded;
}

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
  const out = Buffer.alloc(48 * 48 * 4);
  for (let y = 0; y < 48; y++) {
    const src = ((row * 48 + y) * width + col * 48) * 4;
    out.set(pixels.subarray(src, src + 192), y * 192);
  }
  return out;
}

describe('base atlas', () => {
  const image = sheetImage('base.png');
  const files = SPRITE_GROUPS.map((group) => {
    const json: unknown = JSON.parse(readFileSync(join(sprites, `${group}.json`), 'utf8'));
    return parseAtlas(json, group);
  });
  const merged = mergeAtlases(files);

  it('matches the native 48px grid and keeps the key set without collisions', () => {
    expect(image.width % 48).toBe(0);
    expect(image.height % 48).toBe(0);
    for (const file of files) {
      for (const sheet of file.sheets) {
        const sheetPixels = sheetImage(sheet.image);
        expect(file.frame).toEqual({ w: 48, h: 48 });
        expect(sheetPixels.width % 48).toBe(0);
        expect(sheetPixels.height % 48).toBe(0);
        validateImage(sheet, sheetPixels, file.frame.w);
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
      expect(def.image).toMatch(/\.png$/);
      expect(def.loop).toBe(!(ONE_SHOTS as readonly string[]).includes(name));
      expect(def.headOffset).toHaveLength(def.count);
    }
    for (const name of ACTIVITY_BODY) {
      const def = merged.lookup('body', undefined, name);
      expect(def, name).toBeTruthy();
      if (!def?.headOffset) throw new Error(`missing headOffset for ${name}`);
      expect(def.image).toBe('activity.png');
      expect(def.headOffset).toHaveLength(def.count);
    }
    for (const name of [...BODY, ...ACTIVITY_BODY]) {
      for (const [layer, variants] of [
        ['face', FACES],
        ['outfit', OUTFITS],
        ['accessory', ACCESSORIES],
      ] as const) {
        for (const variant of variants) {
          expect(merged.lookup(layer, variant, name)?.count, `${layer}/${variant}/${name}`).toBe(
            merged.body(name).count,
          );
        }
      }
    }
  });

  it('uses binary alpha and ends one-shots on idle (hide ends transparent)', () => {
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
      const source = sheetImage(def.image ?? 'base.png');
      const last = cell(source.pixels, source.width, def.count - 1, def.row);
      if (name === 'hide') expect(last.every((value) => value === 0)).toBe(true);
      else {
        expect(Buffer.compare(last, idle), name).toBe(0);
        expect(def.headOffset?.[def.count - 1]).toEqual([0, 0]);
      }
    }
  });

  it('draws the default idle layers from the feature sheets', () => {
    for (const group of SPRITE_GROUPS) rememberSprite(`${group}.png`, {} as CanvasImageSource);
    const draws: number[][] = [];
    let smoothing = true;
    const canvas = {
      width: 0,
      height: 0,
      style: { width: '', height: '', imageRendering: '' },
      getContext() {
        return {
          save() {},
          restore() {},
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
    expect(draws.every((draw) => draw[2] === 48 && draw[6] === 96 && draw[4] === 0)).toBe(true);
  });

  function frame(name: string, index: number): Buffer {
    const def = merged.body(name);
    const source = sheetImage(def.image ?? 'base.png');
    return cell(source.pixels, source.width, index, def.row);
  }

  function difference(a: Buffer, b: Buffer): number {
    let count = 0;
    for (let p = 0; p < a.length; p += 4)
      if (!a.subarray(p, p + 4).equals(b.subarray(p, p + 4))) count++;
    return count;
  }

  function faceFrame(mood: string, name: string, index: number): Buffer {
    const def = merged.lookup('face', mood, name);
    if (!def?.image) throw new Error(`missing face ${mood}/${name}`);
    const source = sheetImage(def.image);
    return cell(source.pixels, source.width, index, def.row);
  }

  it('keeps sleepy eyelids separated from the body whiskers throughout idle, sit and yawn', () => {
    for (const name of ['idle', 'sit', 'yawn']) {
      for (let index = 0; index < 8; index++) {
        const body = frame(name, index);
        const face = faceFrame('sleepy', name, index);
        const dy = merged.body(name).headOffset?.[index]?.[1] ?? 0;
        let eyePixels = 0;
        for (let y = 18 + dy; y <= 22 + dy; y++) {
          for (let x = 15; x <= 34; x++) {
            const pixel = (y * 48 + x) * 4;
            if (face[pixel] !== 73 || face[pixel + 3] !== 255) continue;
            eyePixels++;
            for (let yy = y - 1; yy <= y + 1; yy++) {
              for (let xx = x - 1; xx <= x + 1; xx++) {
                const neighbor = (yy * 48 + xx) * 4;
                expect(
                  body[neighbor] === 73 && body[neighbor + 3] === 255,
                  `${name}/${index} eye touches body ink`,
                ).toBe(false);
              }
            }
          }
        }
        expect(eyePixels).toBeGreaterThan(0);
      }
    }
  });

  it('closes yawn eyes for every mood and replaces the resting mouth instead of stacking it', () => {
    const resting = faceFrame('sleepy', 'yawn', 0);
    const closed = faceFrame('sleepy', 'yawn', 1);
    expect(difference(resting, closed)).toBeGreaterThan(0);
    for (let index = 1; index <= 6; index++) {
      const expected = faceFrame('sleepy', 'yawn', index);
      for (const mood of FACES) expect(faceFrame(mood, 'yawn', index)).toEqual(expected);
      if (index < 2 || index > 5) continue;
      const dy = merged.body('yawn').headOffset?.[index]?.[1] ?? 0;
      for (const x of [21, 28]) {
        expect(expected[((27 + dy) * 48 + x) * 4 + 3], 'no resting smile beside open mouth').toBe(
          0,
        );
      }
    }
    expect(faceFrame('sleepy', 'yawn', 7)).toEqual(resting);
  });

  it('keeps both whisker strokes visible inside each cheek, not only on the outline', () => {
    for (const name of ['idle', 'sit', 'yawn']) {
      for (let index = 0; index < 8; index++) {
        const body = frame(name, index);
        const dy = merged.body(name).headOffset?.[index]?.[1] ?? 0;
        for (const row of [24, 26]) {
          for (const start of [14, 32]) {
            let visibleInk = 0;
            for (let x = start; x < start + 4; x++) {
              const pixel = ((row + dy) * 48 + x) * 4;
              if (body[pixel] === 73 && body[pixel + 3] === 255) visibleInk++;
            }
            expect(visibleInk, `${name}/${index} cheek stroke`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('clears each sleepy yawn frame and draws one synchronized frame per layer', () => {
    for (const group of SPRITE_GROUPS) rememberSprite(`${group}.png`, {} as CanvasImageSource);
    const draws: number[][] = [];
    let clears = 0;
    const ctx = {
      imageSmoothingEnabled: false,
      save() {},
      restore() {},
      clearRect() {
        clears++;
        draws.length = 0;
      },
      drawImage(_image: CanvasImageSource, ...args: number[]) {
        draws.push(args);
      },
    };
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
    const animator = createAnimator(canvas as unknown as HTMLCanvasElement, merged);
    for (let index = 0; index < 8; index++) {
      animator.render(
        {
          body: 'yawn',
          face: 'sleepy',
          outfit: 'autumn',
          accessory: 'headphones',
          overlay: null,
          speed: 0.7,
          bubble: null,
          visible: true,
          move: 'stay',
          facing: 'right',
          overlayLevel: 1,
        },
        index * 125,
      );
      expect(clears).toBe(index + 1);
      expect(draws).toHaveLength(4);
      expect(
        draws.every(
          (draw) =>
            draw[0] === index * 48 &&
            draw[2] === 48 &&
            draw[3] === 48 &&
            draw[4] === 0 &&
            draw[5] === 0,
        ),
      ).toBe(true);
    }
  });

  it('gives sitting and each activity visibly different artwork', () => {
    for (const [a, b] of [
      ['idle', 'sit'],
      ['code', 'think'],
      ['code', 'browse'],
      ['think', 'browse'],
    ]) {
      expect(difference(frame(a ?? '', 3), frame(b ?? '', 3)), `${a}/${b}`).toBeGreaterThan(150);
    }
  });

  it('articulates a nod and lean while keeping the feet planted', () => {
    for (const name of ['headbob', 'lean']) {
      const a = frame(name, 0),
        b = frame(name, 4);
      expect(difference(a, b), name).toBeGreaterThan(80);
      for (let y = 40; y < 45; y++) {
        const start = (y * 48 + 14) * 4,
          end = (y * 48 + 34) * 4;
        expect(a.subarray(start, end).equals(b.subarray(start, end)), `${name} feet`).toBe(true);
      }
    }
  });

  it('extends the arms overhead during the stretch', () => {
    const idle = frame('idle', 0),
      stretch = frame('stretch', 3);
    let raised = 0;
    for (let y = 2; y < 20; y++)
      for (const x of [8, 9, 10, 38, 39, 40]) {
        const alpha = (y * 48 + x) * 4 + 3;
        if (stretch[alpha] && !idle[alpha]) raised++;
      }
    expect(raised).toBeGreaterThan(25);
  });
});
