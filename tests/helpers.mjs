// Shared test helpers: an in-memory app with a mocked upstream fetch, and an HTTP client.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { createApp } from '../lib/app.mjs';
import { silentLogger } from '../lib/log.mjs';
export const root = fileURLToPath(new URL('..', import.meta.url));
const finiteSeries = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const times = (n, stepH) => finiteSeries(n, i => new Date(Date.UTC(2026, 8, 12, i * stepH)).toISOString().slice(0, 16));
export function fixtures() {
  return {
    meta: { last_run_initialisation_time: 1789063200, last_run_availability_time: 1789088901, temporal_resolution_seconds: 10800, update_interval_seconds: 21600, data_end_time: 1789592400 },
    ifs: [{ latitude: 30.75, longitude: 79, elevation: 3555, hourly_units: { precipitation: 'mm', soil_moisture_0_to_7cm: 'm³/m³' }, hourly: { time: times(16, 3), precipitation: finiteSeries(16, i => (i === 5 ? null : i * 0.1)), soil_moisture_0_to_7cm: finiteSeries(16, () => 0.36), soil_moisture_7_to_28cm: finiteSeries(16, () => 0.37), soil_moisture_28_to_100cm: finiteSeries(16, () => 0.38), soil_moisture_100_to_255cm: finiteSeries(16, () => 0.41) } }, { latitude: 30.5, longitude: 79, elevation: 2000, hourly_units: { precipitation: 'mm' }, hourly: { time: times(16, 3), precipitation: finiteSeries(16, i => i * 0.3), soil_moisture_0_to_7cm: finiteSeries(16, () => 0.30), soil_moisture_7_to_28cm: finiteSeries(16, () => 0.31), soil_moisture_28_to_100cm: finiteSeries(16, () => 0.32), soil_moisture_100_to_255cm: finiteSeries(16, () => 0.33) } }],
    aifs: [{ latitude: 30.75, longitude: 79, hourly_units: { precipitation: 'mm' }, hourly: { time: times(8, 6), precipitation: finiteSeries(8, i => i) } }],
    ensemble: [{ latitude: 30.75, longitude: 79, hourly_units: { precipitation: 'mm' }, hourly: { time: times(8, 6), precipitation: finiteSeries(8, () => 1), precipitation_member01: finiteSeries(8, () => 0.5), precipitation_member02: finiteSeries(8, () => 1.5), precipitation_member03: finiteSeries(8, () => 1) } }],
    flood: { latitude: 30.725, longitude: 79.075, daily_units: { river_discharge: 'm³/s' }, daily: { time: ['2026-09-12', '2026-09-13'], river_discharge: [6.4, null], river_discharge_p25: [6.3, 6.2], river_discharge_p75: [6.5, 6.4] } },
    cmr: { feed: { entry: [{ producer_granule_id: 'SMAP_L4_SM_gph_20260908T223000_Vv8011_001.h5', id: 'G1', time_start: '2026-09-08T21:00:00.000Z', time_end: '2026-09-09T00:00:00.000Z', granule_size: '143.5', links: [{ rel: 'http://esipfed.org/ns/fedsearch/1.1/data#', href: 'https://data.nsidc.earthdatacloud.nasa.gov/x.h5' }] }] } },
    elevation: n => ({ elevation: finiteSeries(n, i => 1000 + i * 10) }),
    worldpopCreate: { status: 'created', taskid: 'task-1' }, worldpopTask: { status: 'finished', error: false, data: { total_population: 12345.6 }, taskid: 'task-1' },
    geocode: { results: [{ id: 1, name: 'Gangtok', admin1: 'Sikkim', latitude: 27.3, longitude: 88.6, elevation: 1650, country_code: 'IN' }] },
    weather: { latitude: 30.7, longitude: 79.1, current: { time: '2026-09-12T10:00', temperature_2m: 12, precipitation: 0.2 }, hourly: { time: times(48, 1), precipitation: finiteSeries(48, () => 0.1), soil_moisture_0_to_1cm: finiteSeries(48, () => 0.3) } }
  };
}
export function mockFetch(fx = fixtures(), overrides = {}) {
  const calls = [];
  const respond = (url, init) => {
    const u = new URL(url); const key = u.hostname + u.pathname;
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (overrides[key]) return overrides[key](u, init);
    if (u.pathname.endsWith('/static/meta.json')) return fx.meta;
    if (u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast') { const models = u.searchParams.get('models'); if (models === 'ecmwf_ifs025') return fx.ifs; if (models === 'ecmwf_aifs025_single') return fx.aifs; if (models?.includes('ecmwf')) return { latitude: 30.7, longitude: 79.1, hourly: { time: times(48, 1), precipitation_ecmwf_aifs025_single: finiteSeries(48, () => 0.2), precipitation_ecmwf_ifs: finiteSeries(48, () => 0.1) } }; return fx.weather; }
    if (u.hostname === 'ensemble-api.open-meteo.com') return u.searchParams.get('temporal_resolution') ? fx.ensemble : { latitude: 30.7, longitude: 79.1, hourly: { time: times(48, 1), precipitation: finiteSeries(48, () => 1), precipitation_member01: finiteSeries(48, () => 0.5) } };
    if (u.hostname === 'flood-api.open-meteo.com') return fx.flood;
    if (u.hostname === 'cmr.earthdata.nasa.gov') return fx.cmr;
    if (u.pathname === '/v1/elevation') return fx.elevation(u.searchParams.get('latitude').split(',').length);
    if (u.hostname === 'api.worldpop.org') return u.pathname.startsWith('/v1/tasks') ? fx.worldpopTask : fx.worldpopCreate;
    if (u.hostname === 'geocoding-api.open-meteo.com') return fx.geocode;
    throw new Error(`unmocked ${key}`);
  };
  const fetchImpl = async (url, init) => { const data = respond(url, init); if (data instanceof Response) return data; return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); };
  fetchImpl.calls = calls;
  return fetchImpl;
}
export function testConfig(extra = {}) { return loadConfig({ NODE_ENV: 'test', AEGIS_DB_PATH: ':memory:', LOG_LEVEL: 'error', RATE_LIMIT_PER_MINUTE: '10000', ...extra }); }
export async function startApp({ config = testConfig(), fetchImpl = mockFetch() } = {}) {
  const app = createApp({ config, root, logger: silentLogger, fetchImpl, storePath: ':memory:' });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = async (path, { method = 'GET', body, headers = {} } = {}) => { const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: res.status, headers: res.headers, json, text }; };
  return { app, server, base, client, fetchImpl, close: () => new Promise(r => { server.close(() => { app.close(); r(); }); }) };
}
