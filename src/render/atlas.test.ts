import { describe, expect, it } from 'vitest';

import {
  type AnimationDef,
  AtlasError,
  type AtlasFile,
  mergeAtlases,
  parseAtlas,
  validateImage,
} from './atlas';

const idle = (count = 4): AnimationDef => ({
  row: 0,
  start: 0,
  count,
  fps: 4,
  loop: true,
});

function bodyFile(animations: Record<string, AnimationDef>): AtlasFile {
  return {
    version: 1,
    group: 'base',
    frame: { w: 32, h: 32 },
    sheets: [{ layer: 'body', image: 'base.png', animations }],
  };
}

const baseJson = {
  version: 1,
  group: 'base',
  frame: { w: 32, h: 32 },
  sheets: [
    {
      layer: 'body',
      image: 'base.png',
      animations: { idle: { row: 0, start: 0, count: 4, fps: 4, loop: true } },
    },
  ],
};

describe('atlas loader', () => {
  it('rejects a bad version, a group mismatch, and an unknown animation', () => {
    expect(() => parseAtlas({ ...baseJson, version: 2 }, 'base')).toThrow(AtlasError);
    expect(() => parseAtlas({ ...baseJson, group: 'other' }, 'base')).toThrow(AtlasError);
    expect(() =>
      parseAtlas(
        {
          ...baseJson,
          sheets: [
            {
              layer: 'body',
              image: 'base.png',
              animations: { spin: { row: 0, start: 0, count: 1, fps: 4, loop: true } },
            },
          ],
        },
        'base',
      ),
    ).toThrow(/unknown animation/);
  });

  it('rejects an unknown or missing variant and a variant on body', () => {
    expect(() =>
      parseAtlas(
        {
          version: 1,
          group: 'faces',
          frame: { w: 32, h: 32 },
          sheets: [
            {
              layer: 'face',
              image: 'faces.png',
              variant: 'glow',
              animations: { '*': { row: 0, start: 0, count: 1, fps: 1, loop: true } },
            },
          ],
        },
        'faces',
      ),
    ).toThrow(/unknown variant/);
    expect(() =>
      parseAtlas(
        {
          version: 1,
          group: 'faces',
          frame: { w: 32, h: 32 },
          sheets: [
            {
              layer: 'face',
              image: 'faces.png',
              animations: { '*': { row: 0, start: 0, count: 1, fps: 1, loop: true } },
            },
          ],
        },
        'faces',
      ),
    ).toThrow(/requires variant/);
    expect(() =>
      parseAtlas(
        {
          ...baseJson,
          sheets: [
            {
              layer: 'body',
              variant: 'extra',
              image: 'base.png',
              animations: { idle: { row: 0, start: 0, count: 1, fps: 4, loop: true } },
            },
          ],
        },
        'base',
      ),
    ).toThrow(/cannot set variant/);
  });

  it('rejects a short headOffset and an undersized image', () => {
    expect(() =>
      parseAtlas(
        {
          ...baseJson,
          sheets: [
            {
              layer: 'body',
              image: 'base.png',
              animations: {
                idle: {
                  row: 0,
                  start: 0,
                  count: 2,
                  fps: 4,
                  loop: true,
                  headOffset: [[0, 0]],
                },
              },
            },
          ],
        },
        'base',
      ),
    ).toThrow(/headOffset/);
    const sheet = bodyFile({ idle: idle(2) }).sheets[0];
    if (!sheet) throw new Error('missing sheet');
    expect(() => validateImage(sheet, { width: 32, height: 32 })).toThrow(/too small/);
  });

  it('rejects a duplicate key and a count mismatch', () => {
    const body = bodyFile({ walk: idle(4) });
    expect(() => mergeAtlases([body, { ...body, group: 'petting' }])).toThrow(/duplicate key/);
    const face: AtlasFile = {
      version: 1,
      group: 'faces',
      frame: { w: 32, h: 32 },
      sheets: [
        {
          layer: 'face',
          image: 'faces.png',
          variant: 'content',
          animations: { walk: { row: 0, start: 0, count: 2, fps: 4, loop: true } },
        },
      ],
    };
    expect(() => mergeAtlases([body, face])).toThrow(/count mismatch/);
  });

  it('falls back to the star entry and to idle once', () => {
    const merged = mergeAtlases([
      bodyFile({ idle: idle(1) }),
      {
        version: 1,
        group: 'faces',
        frame: { w: 32, h: 32 },
        sheets: [
          {
            layer: 'face',
            image: 'faces.png',
            variant: 'content',
            animations: { '*': { row: 1, start: 0, count: 1, fps: 1, loop: true } },
          },
        ],
      },
    ]);
    expect(merged.lookup('face', 'content', 'idle')?.row).toBe(1);
    const logs: string[] = [];
    const bodies = mergeAtlases([bodyFile({ idle: idle(1) })], (message) => logs.push(message));
    expect(bodies.body('walk').count).toBe(1);
    expect(bodies.body('sit').count).toBe(1);
    expect(logs).toHaveLength(1);
  });
});
