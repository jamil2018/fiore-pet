import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FEATURES } from '../types';
import { REACTIONS } from './index';

describe('reaction registry', () => {
  it('registers the six features in order', () => {
    expect(REACTIONS.map((reaction) => reaction.id)).toEqual([...FEATURES]);
    expect(new Set(REACTIONS.map((reaction) => reaction.id)).size).toBe(FEATURES.length);
  });

  it('keeps feature modules free of io imports', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && name !== 'index.ts' && !name.endsWith('.test.ts'),
    );
    expect(files.length).toBe(6);
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(spec === '../types' || spec === '../../events').toBe(true);
      }
    }
  });
});
