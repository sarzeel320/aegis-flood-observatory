import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.mjs';

test('Vercel uses writable temporary storage and honours explicit overrides', () => {
  const config = loadConfig({ VERCEL: '1' });
  assert.equal(config.AEGIS_DB_PATH, '/tmp/aegis.sqlite');
  assert.equal(config.HOST, '0.0.0.0');
  assert.equal(config.TRUST_PROXY, true);
  assert.equal(loadConfig({}).AEGIS_DB_PATH, 'data/aegis.sqlite');
  assert.equal(loadConfig({ VERCEL: '1', AEGIS_DB_PATH: ':memory:' }).AEGIS_DB_PATH, ':memory:');
});
