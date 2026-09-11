// Application factory: wires configuration, store, providers, routers and static file serving.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep, join } from 'node:path';
import { createLogger } from './log.mjs';
import { openStore } from './store/db.mjs';
import { createFetcher } from './http/fetch.mjs';
import { createRouter, createRateLimiter, json, HttpError } from './http/router.mjs';
import { loadCatchments } from './catchments.mjs';
import { createOpenMeteo } from './providers/openmeteo.mjs';
import { createGlofas } from './providers/glofas.mjs';
import { createSmap } from './providers/smap.mjs';
import { createTerrain, terrainProduct } from './providers/terrain.mjs';
import { createExposure } from './providers/exposure.mjs';
import { weatherNextStatus } from './providers/weathernext.mjs';
import { loadModelStatus } from './model/status.mjs';
import { createNotifications } from './notifications.mjs';
import { registerV1 } from './api/v1.mjs';
import { compareForecasts } from './forecasts.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
export function createApp({ config, root, logger = createLogger({ level: config.LOG_LEVEL }), fetchImpl = globalThis.fetch, storePath = config.AEGIS_DB_PATH === ':memory:' ? ':memory:' : resolve(root, config.AEGIS_DB_PATH) } = {}) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const store = openStore(storePath);
  const fetch = createFetcher({ timeoutMs: config.OUTBOUND_TIMEOUT_MS, maxBytes: config.OUTBOUND_MAX_BYTES, logger, fetchImpl });
  const catchments = loadCatchments(root);
  store.samplePoints = id => catchments.samplePoints(id, 9);
  const providers = {
    openMeteo: createOpenMeteo({ fetch, store, logger }),
    glofas: createGlofas({ fetch, store, ttlSeconds: config.CACHE_TTL_SECONDS * 6 }),
    smap: createSmap({ fetch, store, config, root }),
    terrain: Object.assign(createTerrain({ fetch, store, catchments }), { product: terrainProduct }),
    exposure: createExposure({ fetch, store }),
    weatherNext: weatherNextStatus(config)
  };
  const modelStatus = () => loadModelStatus(root, config);
  const notifications = createNotifications({ store, config, catchments, logger });
  const rateLimiter = createRateLimiter({ perMinute: config.RATE_LIMIT_PER_MINUTE });
  const router = createRouter({ logger, config, rateLimiter });
  registerV1(router, { catchments, providers, store, config, modelStatus, notifications, logger, version });
  const startedAt = new Date().toISOString();
  const readiness = () => { try { store.db.prepare('SELECT 1').get(); return { store: 'ok', catchments: catchments.ids().length }; } catch (error) { return { store: 'failed', error: error.message }; } };
  router.get('/api/health', () => ({ body: { status: 'ok', service: 'aegis', version, startedAt, mode: modelStatus().mode, riskModel: 'demonstration', floodProbability: 'null until calibrated', notifications: config.NOTIFICATION_SENDS_ENABLED ? 'enabled' : 'disabled (preview and queue only)', catchmentEdition: catchments.edition } }));
  router.get('/api/ready', () => { const r = readiness(); return { status: r.store === 'ok' ? 200 : 503, body: { status: r.store === 'ok' ? 'ready' : 'not-ready', ...r, archivedRuns: store.forecastRuns.count() } }; });
  router.get('/api/config', () => ({ body: { maps: { engine: 'MapLibre GL JS', version: '6.9.0', hosted: '/vendor/maplibre-gl/', basemap: 'OpenFreeMap Liberty (OpenStreetMap contributors, OpenMapTiles)', imagery: 'Esri World Imagery', terrain: 'AWS Terrain Tiles (Terrarium; Mapzen, SRTM, Copernicus)', keysRequired: false } } }));
  // Legacy point routes kept for the existing UI. Same validation, caching and failure semantics as before.
  router.get('/api/places', async ctx => {
    const query = ctx.query.get('q')?.trim();
    if (!query || query.length < 2 || query.length > 100 || /[<>]/.test(query)) throw new HttpError(400, 'Enter a place name between 2 and 100 characters');
    const key = `places:${query.toLowerCase()}`;
    const hit = store.cache.get(key); if (hit) return { body: hit.value };
    const params = new URLSearchParams({ name: query, countryCode: 'IN', count: '8', language: 'en', format: 'json' });
    const data = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    const value = { source: 'GeoNames via Open-Meteo', results: (data.results || []).filter(p => p.country_code === 'IN').map(({ id, name, admin1, latitude, longitude, elevation }) => ({ id, name, state: admin1 || 'India', latitude, longitude, elevation })) };
    store.cache.set(key, value, 86400);
    return { body: value };
  });
  router.get('/api/weather', async ctx => {
    const { lat, lon } = router.parseLatLon(ctx.query);
    const key = `weather:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = store.cache.get(key); if (hit) return { body: { ...hit.value, servedFrom: 'cache', cachedAt: hit.savedAt } };
    const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: 'precipitation,soil_moisture_0_to_1cm', current: 'temperature_2m,precipitation', forecast_days: '2', timezone: 'Asia/Kolkata' });
    try {
      const weather = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!Array.isArray(weather.hourly?.precipitation)) throw new HttpError(502, 'Invalid weather response');
      const data = { source: 'Open-Meteo', kind: 'weather-model-forecast', fetchedAt: new Date().toISOString(), ...weather };
      store.cache.set(key, data, config.CACHE_TTL_SECONDS);
      return { body: data };
    } catch (error) {
      const stale = store.cache.getStale(key);
      if (stale) return { body: { ...stale.value, servedFrom: 'stale-cache', cachedAt: stale.savedAt, staleReason: error.message } };
      throw new HttpError(502, 'Live weather is temporarily unavailable. Demonstration data remains explicitly labeled.');
    }
  });
  router.get('/api/compare', async ctx => {
    const { lat, lon } = router.parseLatLon(ctx.query);
    const key = `compare:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = store.cache.get(key); if (hit) return { body: hit.value };
    const data = await compareForecasts(lat, lon, { fetchJSON: url => fetch(url) });
    if (data.models.every(m => m.status === 'unavailable')) throw new HttpError(502, 'Comparison providers are temporarily unavailable');
    if (data.models.every(m => m.status === 'available')) store.cache.set(key, data, config.CACHE_TTL_SECONDS);
    return { body: data };
  });
  const publicRoot = join(root, 'public') + sep;
  const docsRoot = join(root, 'docs') + sep;
  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    let base = publicRoot, pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (pathname.startsWith('/docs/')) { base = docsRoot; pathname = pathname.slice(5); }
    else if (pathname.startsWith('/datasets/')) { base = join(root, 'datasets') + sep; pathname = pathname.slice(9); }
    const path = resolve(base, '.' + pathname);
    if (!path.startsWith(base) || /(^|\/)\./.test(pathname)) return json(res, 403, { error: 'Forbidden' });
    try { const body = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': body.length }); res.end(req.method === 'HEAD' ? undefined : body); }
    catch { json(res, 404, { error: 'Not found' }); }
  }
  const sweep = setInterval(() => { rateLimiter.sweep(); store.cache.purge(); }, 60000); sweep.unref?.();
  return { handle: (req, res) => router.handle(req, res, serveStatic), store, catchments, providers, config, logger, notifications, modelStatus, close: () => { clearInterval(sweep); store.close(); } };
}
