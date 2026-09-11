#!/usr/bin/env node
// Ingest historical reanalysis features per catchment for model training: ERA5-Land (0.1°) daily precipitation and
// hourly soil moisture layers, via the Open-Meteo historical weather API. Reanalysis is NOT a forecast; it is used to
// build a baseline feature table whose lead-time results are an upper bound on what forecasts can deliver.
// Output: datasets/history/<catchmentId>.json  (daily rows, catchment mean of sample points, null preserved)
// Usage: node scripts/ingest-history.mjs [--start 2005-01-01] [--end 2025-12-31] [--points 1]
// Default is one ERA5-Land cell (the seed point) per catchment to stay within provider request weights.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleGrid } from '../lib/geo.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const start = args.start || '2005-01-01', end = args.end || '2025-12-31', pointsPer = Number(args.points || 1);
const catchments = JSON.parse(readFileSync(join(root, 'datasets', 'catchments.geojson'), 'utf8'));
const outDir = join(root, 'datasets', 'history'); mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Open-Meteo weights long hourly requests as many API calls and enforces minute/hour/day limits. On a limit error
// the script waits for the next hour boundary and retries the same chunk, so a full run is slow but unattended.
async function fetchJSON(url, attempt = 0) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (data?.error && /limit/i.test(data.reason || '')) {
    const now = new Date(); const wait = (60 - now.getUTCMinutes()) * 60000 - now.getUTCSeconds() * 1000 + 90000;
    console.error(`rate limit: ${data.reason} · waiting ${Math.round(wait / 60000)} min`); await sleep(wait); return fetchJSON(url, attempt);
  }
  if (response.status === 429 || response.status >= 500) { if (attempt < 5) { await sleep(2000 * 2 ** attempt); return fetchJSON(url, attempt + 1); } }
  if (!response.ok || !data) throw new Error(`${response.status} ${text.slice(0, 200)}`);
  return data;
}
const mean = a => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null; };
function chunks(from, to) { const out = []; let y = Number(from.slice(0, 4)); const endY = Number(to.slice(0, 4)); while (y <= endY) { const y2 = Math.min(endY, y + 4); out.push([y === Number(from.slice(0, 4)) ? from : `${y}-01-01`, y2 === endY ? to : `${y2}-12-31`]); y = y2 + 1; } return out; }
for (const feature of catchments.features) {
  const id = feature.id, outPath = join(outDir, `${id}.json`);
  if (existsSync(outPath) && !args.force) { const prior = JSON.parse(readFileSync(outPath, 'utf8')); if (prior.rows.some(r => Number.isFinite(r.precipitationMm))) { console.error(`${id}: exists, skip`); continue; } console.error(`${id}: exists without precipitation, re-ingesting`); }
  const points = [feature.properties.seedPoint.coordinates, ...sampleGrid(feature.geometry, 9)].slice(0, pointsPer);
  const daily = new Map(); // date -> { precipitationMm: [], precipitationHours: [], soil0_7: [], soil7_28: [] }
  for (const [from, to] of chunks(start, end)) {
    // ERA5-Land daily precipitation_sum returned null through this endpoint; hourly precipitation is summed here instead.
    const params = new URLSearchParams({ latitude: points.map(p => p[1]).join(','), longitude: points.map(p => p[0]).join(','), start_date: from, end_date: to, hourly: 'precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm', models: 'era5_land', timezone: 'UTC' });
    const raw = await fetchJSON(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    const responses = Array.isArray(raw) ? raw : [raw];
    // distinct grid cells only
    const cells = [...new Map(responses.map(r => [`${r.latitude},${r.longitude}`, r])).values()];
    const hTimes = cells[0].hourly.time;
    const byDay = new Map();
    for (let i = 0; i < hTimes.length; i++) {
      const day = hTimes[i].slice(0, 10);
      const s = byDay.get(day) || { p: [], a: [], b: [] };
      s.p.push(mean(cells.map(c => c.hourly.precipitation[i]))); s.a.push(mean(cells.map(c => c.hourly.soil_moisture_0_to_7cm[i]))); s.b.push(mean(cells.map(c => c.hourly.soil_moisture_7_to_28cm[i])));
      byDay.set(day, s);
    }
    for (const [day, s] of byDay) {
      const row = daily.get(day) || { precipitationMm: [], precipitationHours: [], soil0_7: [], soil7_28: [] };
      const hours = s.p.filter(Number.isFinite);
      row.precipitationMm.push(hours.length === s.p.length && hours.length ? hours.reduce((x, y) => x + y, 0) : null); // any missing hour → missing day, never a partial sum
      row.precipitationHours.push(hours.length === s.p.length ? hours.filter(v => v > 0).length : null);
      row.soil0_7.push(mean(s.a)); row.soil7_28.push(mean(s.b));
      daily.set(day, row);
    }
    console.error(`${id}: ${from}..${to} · ${cells.length} ERA5-Land cells`);
    await sleep(400);
  }
  const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, precipitationMm: mean(r.precipitationMm), precipitationHours: mean(r.precipitationHours), soil0_7: mean(r.soil0_7), soil7_28: mean(r.soil7_28) }));
  writeFileSync(outPath, JSON.stringify({ catchmentId: id, source: 'ERA5-Land reanalysis (ECMWF/Copernicus C3S) via Open-Meteo historical weather API', datasetVersion: 'era5_land, 0.1° (~11 km), hourly; retrieved ' + new Date().toISOString(), license: 'CC BY 4.0 (Open-Meteo); Copernicus C3S licence', variables: { precipitationMm: 'daily total (sum of hourly precipitation), mm, catchment mean of sample cells; null if any hour is missing', precipitationHours: 'hours with precipitation > 0', soil0_7: 'volumetric soil water 0–7 cm, m³/m³, daily mean', soil7_28: 'volumetric soil water 7–28 cm, m³/m³, daily mean' }, samplePoints: points, period: { start, end }, rows }));
  console.error(`${id}: wrote ${rows.length} daily rows`);
}
