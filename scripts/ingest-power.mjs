#!/usr/bin/env node
// Ingest historical daily features per catchment from the NASA POWER daily point API (no credentials, no hourly
// quota weighting): bias-corrected precipitation (PRECTOTCORR, mm/day) and surface / root-zone soil wetness
// (GWETTOP, GWETROOT; dimensionless 0–1 degree-of-saturation from the MERRA-2 land model, NOT m³/m³ and NOT measured).
// Output: datasets/history/<catchmentId>.json in the schema consumed by scripts/train-baseline.mjs.
// Usage: node scripts/ingest-power.mjs [--start 2005-01-01] [--end 2025-12-31] [--force]
// Source: https://power.larc.nasa.gov/docs/services/api/temporal/daily/  (NASA POWER v2.9.x, MERRA-2 / GPM-corrected)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid } from '../lib/geo.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : []).filter(Boolean));
const start = String(args.start || '2005-01-01'), end = String(args.end || '2025-12-31');
const catchments = JSON.parse(readFileSync(join(root, 'datasets', 'catchments.geojson'), 'utf8'));
const outDir = join(root, 'datasets', 'history'); mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchJSON(url, attempt = 0) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) { await sleep(3000 * 2 ** attempt); return fetchJSON(url, attempt + 1); }
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
}
const value = (v, fill) => (typeof v === 'number' && v !== fill && Number.isFinite(v) ? v : null);
for (const feature of catchments.features) {
  const id = feature.id, outPath = join(outDir, `${id}.json`);
  if (existsSync(outPath) && !args.force) { const prior = JSON.parse(readFileSync(outPath, 'utf8')); if (prior.source?.startsWith('NASA POWER') && prior.rows.some(r => Number.isFinite(r.precipitationMm))) { console.error(`${id}: exists, skip`); continue; } }
  const [lon, lat] = centroid(feature.geometry);
  const params = new URLSearchParams({ parameters: 'PRECTOTCORR,GWETTOP,GWETROOT', community: 'AG', longitude: lon.toFixed(4), latitude: lat.toFixed(4), start: start.replace(/-/g, ''), end: end.replace(/-/g, ''), format: 'JSON' });
  const raw = await fetchJSON(`https://power.larc.nasa.gov/api/temporal/daily/point?${params}`);
  const fill = raw.header?.fill_value ?? -999, p = raw.properties.parameter;
  const dates = Object.keys(p.PRECTOTCORR).sort();
  const rows = dates.map(d => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, precipitationMm: value(p.PRECTOTCORR[d], fill), precipitationHours: null, soilSurface: value(p.GWETTOP?.[d], fill), soilRoot: value(p.GWETROOT?.[d], fill) }));
  writeFileSync(outPath, JSON.stringify({ catchmentId: id, source: 'NASA POWER daily point API (MERRA-2 land model; precipitation bias-corrected)', datasetVersion: `${raw.header?.title ?? 'POWER daily'} · API ${raw.header?.api?.version ?? '?'} · sources ${(raw.header?.sources ?? []).join(',')} · retrieved ${new Date().toISOString()}`, license: 'NASA POWER data are freely available (public domain, cite NASA POWER Project)', nativeResolution: 'MERRA-2 0.5° × 0.625° grid; daily; local solar time', requestPoint: { longitude: lon, latitude: lat, basis: 'catchment centroid' }, variables: { precipitationMm: 'PRECTOTCORR: bias-corrected precipitation, mm/day', precipitationHours: 'not provided by POWER (null)', soilSurface: 'GWETTOP: surface soil wetness, dimensionless 0–1 (degree of saturation from the land model; not m³/m³, not measured)', soilRoot: 'GWETROOT: root-zone soil wetness, dimensionless 0–1' }, period: { start, end }, fillValue: fill, rows }));
  console.error(`${id}: wrote ${rows.length} daily rows (${rows.filter(r => r.precipitationMm === null).length} missing precipitation)`);
  await sleep(500);
}
