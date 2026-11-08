import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const probe = readFileSync(new URL('./browser_probe.js', import.meta.url), 'utf8');
function read(mediaSession, elements = []) {
  return JSON.parse(vm.runInNewContext(probe, {
    navigator: { mediaSession },
    document: {
      querySelectorAll(selector) { assert.equal(selector, 'audio,video'); return elements; },
      get title() { throw new Error('must not read document title'); },
      get body() { throw new Error('must not read document body'); },
    },
  }, { timeout: 100 }));
}
const audible = { paused: false, ended: false, muted: false, volume: 1, readyState: 4 };

test('metadata alone and paused media never imply playback', () => {
  assert.deepEqual(read({ playbackState: 'paused', metadata: { title: 'Old', artist: 'Artist' } }),
    { playing: false, title: '', artist: '' });
  assert.equal(read(undefined, [{ ...audible, paused: true }]).playing, false);
});
test('MediaSession supports background and WebAudio playback without HTML elements', () => {
  assert.deepEqual(read({ playbackState: 'playing', metadata: { title: 'Track', artist: 'Artist' } }),
    { playing: true, title: 'Track', artist: 'Artist' });
});
test('HTML media fallback detects actual playback without inventing metadata', () => {
  assert.deepEqual(read(undefined, [audible]), { playing: true, title: '', artist: '' });
  for (const change of [{ muted: true }, { volume: 0 }, { ended: true }, { readyState: 1 }]) {
    assert.equal(read(undefined, [{ ...audible, ...change }]).playing, false);
  }
});
test('bounded metadata accepts strings only', () => {
  const result = read({ playbackState: 'playing', metadata: { title: 'x'.repeat(2000), artist: {} } });
  assert.equal(result.title.length, 512);
  assert.equal(result.artist, '');
});
test('inaccessible page state is a recoverable stopped observation', () => {
  const session = { get playbackState() { throw new Error('inaccessible frame'); } };
  assert.equal(read(session).playing, false);
});
