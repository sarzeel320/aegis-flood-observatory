import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, describeConfig } from '../lib/config.mjs';
import { redact, createLogger } from '../lib/log.mjs';
import { createFetcher, UpstreamError } from '../lib/http/fetch.mjs';
import { createRateLimiter } from '../lib/http/router.mjs';
import { openStore } from '../lib/store/db.mjs';

test('config validates types, ranges and enums', () => {
  assert.equal(loadConfig({}).PORT, 4173);
  assert.throws(() => loadConfig({ PORT: '99999' }), ConfigError);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'loud' }), ConfigError);
  assert.throws(() => loadConfig({ NOTIFICATION_SENDS_ENABLED: 'true' }), /requires a configured NOTIFICATION_PROVIDER/);
  assert.equal(loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0' }).HOST, '0.0.0.0', 'hosting platforms bind all interfaces');
  assert.deepEqual(loadConfig({ ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443' }).ALLOWED_ORIGINS, ['https://a.example', 'https://b.example:8443']);
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: 'javascript:alert(1)' }), ConfigError);
});
test('config description never exposes secret values', () => {
  const d = describeConfig(loadConfig({ EARTHDATA_TOKEN: 'super-secret-token', ADMIN_API_KEY: 'eyJ.abc.def' }));
  assert.equal(d.EARTHDATA_TOKEN, 'configured'); assert.equal(d.ADMIN_API_KEY, 'configured');
  assert.equal(JSON.stringify(d).includes('super-secret'), false);
});
test('logger redacts credentials, tokens, phone numbers and raw payloads', () => {
  const out = redact({ authorization: 'Bearer abc', phone: '+919999900001', nested: { apiKey: 'k', note: 'call +91 99999 00001 now', jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz' }, payload: { raw: 1 } });
  assert.equal(out.authorization, '[redacted]'); assert.equal(out.phone, '[redacted]'); assert.equal(out.nested.apiKey, '[redacted]');
  assert.ok(!out.nested.note.includes('99999')); assert.ok(!out.nested.jwt.includes('eyJhbGci')); assert.equal(out.payload, '[omitted]');
  assert.equal(redact({ issuedAt: '2026-09-10T18:00:00.000Z', note: 'run 2026-09-10 at 18:00, id 4080756600' }).issuedAt, '2026-09-10T18:00:00.000Z', 'ISO timestamps are not phone numbers');
  assert.equal(redact('ring +919999900001 today'), 'ring [redacted-number] today');
  const lines = []; const logger = createLogger({ level: 'info', stream: { write: l => lines.push(l) } });
  logger.debug('hidden'); logger.info('shown', { token: 'x', ok: 1 });
  assert.equal(lines.length, 1); const parsed = JSON.parse(lines[0]); assert.equal(parsed.token, '[redacted]'); assert.equal(parsed.ok, 1); assert.ok(parsed.time);
});
test('outbound fetch enforces allow-list, https, timeouts, retries and size bounds', async () => {
  let attempts = 0;
  const fetchImpl = async (url) => { attempts++; const u = new URL(url); if (u.pathname === '/flaky') return new Response('{"ok":true}', { status: attempts < 3 ? 503 : 200 }); if (u.pathname === '/big') return new Response('x'.repeat(2000), { status: 200, headers: { 'content-length': '2000' } }); if (u.pathname === '/stream') return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('y'.repeat(1500))); c.close(); } }), { status: 200 }); if (u.pathname === '/slow') return new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50)); return new Response('{"ok":true}', { status: 200 }); };
  const boundedFetch = createFetcher({ fetchImpl, timeoutMs: 20, maxBytes: 1000, retries: 3, baseDelayMs: 1 });
  await assert.rejects(boundedFetch('http://api.open-meteo.com/x'), /Only https/);
  await assert.rejects(boundedFetch('https://evil.example/x'), /not allow-listed/);
  assert.deepEqual(await boundedFetch('https://api.open-meteo.com/flaky'), { ok: true }); assert.equal(attempts, 3);
  await assert.rejects(boundedFetch('https://api.open-meteo.com/big'), /size bound/);
  await assert.rejects(boundedFetch('https://api.open-meteo.com/stream'), /size bound/);
  await assert.rejects(boundedFetch('https://api.open-meteo.com/slow', { }), UpstreamError);
});
test('rate limiter refills over time', () => {
  let t = 0; const limiter = createRateLimiter({ perMinute: 2, now: () => t });
  assert.equal(limiter.take('a').ok, true); assert.equal(limiter.take('a').ok, true); assert.equal(limiter.take('a').ok, false);
  t = 30000; assert.equal(limiter.take('a').ok, true); assert.equal(limiter.take('b').ok, true);
});
test('persistent cache honours TTL and serves stale entries explicitly', () => {
  const store = openStore(':memory:');
  store.cache.set('k', { v: 1 }, 0);
  assert.equal(store.cache.get('k'), null);
  assert.equal(store.cache.getStale('k').stale, true);
  store.cache.set('k', { v: 2 }, 60);
  assert.deepEqual(store.cache.get('k').value, { v: 2 });
  store.close();
});
test('delivery queue is idempotent on the idempotency key', () => {
  const store = openStore(':memory:');
  const a = store.deliveries.enqueue({ advisoryId: 'adv', subscriptionId: 'sub', idempotencyKey: 'adv:sub:1', status: 'held' });
  const b = store.deliveries.enqueue({ advisoryId: 'adv', subscriptionId: 'sub', idempotencyKey: 'adv:sub:1', status: 'held' });
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.id, b.id);
  assert.equal(store.deliveries.listForAdvisory('adv').length, 1);
  store.close();
});
