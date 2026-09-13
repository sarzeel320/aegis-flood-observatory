import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadBaseStyle, waitForStyle } from '../public/src/map-style.js';

test('blocked or malformed basemaps return a usable local style', async () => {
  for (const response of [new Response('denied', { status: 403 }), new Response('{}')]) {
    const result = await loadBaseStyle('https://map.example/style', async () => response);
    assert.equal(result.fallback, true);
    assert.equal(result.style.version, 8);
    assert.equal(result.style.layers[0].type, 'background');
  }
});
test('slow style requests fall back and successful styles are preserved', async () => {
  const result = await loadBaseStyle('https://map.example/style', (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))), 5);
  assert.equal(result.fallback, true);
  const style = { version: 8, sources: {}, layers: [] };
  assert.deepEqual(await loadBaseStyle('https://map.example/style', async () => Response.json(style)), { style, fallback: false });
});
test('tile errors cannot abort style startup or remove the map', async () => {
  const map = new EventEmitter(); map.isStyleLoaded = () => false;
  map.on('error', () => {});
  const ready = waitForStyle(map, 100);
  map.emit('error', { error: new Error('tile unavailable') });
  map.emit('style.load');
  await ready;
  assert.equal(map.listenerCount('style.load'), 0);
});
