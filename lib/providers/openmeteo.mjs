// Forecast-run archive adapter for ECMWF IFS / AIFS and the Google WeatherNext 2 ensemble as distributed by Open-Meteo.
// Runs are fetched at the provider's native temporal resolution, archived verbatim before any aggregation,
// then averaged over the catchment's distinct grid cells. Missing values stay null.
const OPEN_METEO_LICENSE = 'CC BY 4.0 (Open-Meteo, https://open-meteo.com/en/license); ECMWF open data CC BY 4.0';
export const models = {
  ecmwf_ifs025: { id: 'ecmwf_ifs025', name: 'ECMWF IFS 0.25°', kind: 'physics-deterministic', api: 'forecast', host: 'api.open-meteo.com', metaPath: '/data/ecmwf_ifs025/static/meta.json', nativeResolutionM: 25000, precipitation: 'precipitation', soilLayers: [{ key: 'soil_moisture_0_to_7cm', topCm: 0, bottomCm: 7 }, { key: 'soil_moisture_7_to_28cm', topCm: 7, bottomCm: 28 }, { key: 'soil_moisture_28_to_100cm', topCm: 28, bottomCm: 100 }, { key: 'soil_moisture_100_to_255cm', topCm: 100, bottomCm: 255 }], license: OPEN_METEO_LICENSE, sourceUrl: 'https://open-meteo.com/en/docs/ecmwf-api' },
  ecmwf_aifs025_single: { id: 'ecmwf_aifs025_single', name: 'ECMWF AIFS Single 0.25°', kind: 'ml-deterministic', api: 'forecast', host: 'api.open-meteo.com', metaPath: '/data/ecmwf_aifs025_single/static/meta.json', nativeResolutionM: 25000, precipitation: 'precipitation', soilLayers: [], license: OPEN_METEO_LICENSE, sourceUrl: 'https://open-meteo.com/en/docs/ecmwf-api' },
  google_weathernext2_ensemble: { id: 'google_weathernext2_ensemble', name: 'Google WeatherNext 2 ensemble', kind: 'ml-ensemble', api: 'ensemble', host: 'ensemble-api.open-meteo.com', metaPath: '/data/google_weathernext2_ensemble/static/meta.json', nativeResolutionM: 25000, precipitation: 'precipitation', soilLayers: [], license: 'Open-Meteo CC BY 4.0; WeatherNext 2 model outputs under Google research terms', sourceUrl: 'https://open-meteo.com/en/docs/google-weathernext-api', note: 'WeatherNext 2 is the open research model. It is NOT WeatherNext 3, which is an allow-listed operational service.' }
};
const finite = n => typeof n === 'number' && Number.isFinite(n);
const utc = t => (t.endsWith('Z') ? t : t + ':00Z').replace(/:00:00Z$/, ':00Z');
const mean = a => Math.round(a.reduce((s, n) => s + n, 0) / a.length * 10000) / 10000;
function quantile(values, p) { const s = [...values].sort((a, b) => a - b), at = (s.length - 1) * p; return s[Math.floor(at)] + (s[Math.ceil(at)] - s[Math.floor(at)]) * (at % 1); }

// Aggregate an array of per-point responses into a catchment series. Duplicate grid cells are collapsed.
export function aggregateRun(responses, model) {
  const cells = new Map();
  for (const r of responses) { const key = `${r.latitude},${r.longitude}`; if (!cells.has(key)) cells.set(key, r); }
  const cellList = [...cells.values()];
  const times = cellList[0]?.hourly?.time?.map(utc) ?? [];
  const stepSeconds = times.length > 1 ? (Date.parse(times[1]) - Date.parse(times[0])) / 1000 : null;
  const variables = Object.keys(cellList[0]?.hourly ?? {}).filter(k => k !== 'time');
  const memberKeys = variables.filter(k => /^precipitation_member\d+$/.test(k));
  const aggregate = key => times.map((_, i) => { const v = cellList.map(c => c.hourly[key]?.[i]).filter(finite); return v.length ? { mean: mean(v), min: Math.min(...v), max: Math.max(...v), n: v.length } : null; });
  const series = { times, stepSeconds, precipitationMm: null, precipitationSpread: null, soil: {}, ensemble: null };
  if (memberKeys.length) {
    // Ensemble: per member catchment-mean series, then per-step statistics across members.
    const perMember = memberKeys.map(k => aggregate(k).map(v => v?.mean ?? null));
    const control = aggregate('precipitation').map(v => v?.mean ?? null);
    const stats = times.map((_, i) => { const v = perMember.map(m => m[i]).filter(finite); return v.length === perMember.length ? { mean: mean(v), p10: quantile(v, .1), p90: quantile(v, .9), min: Math.min(...v), max: Math.max(...v) } : null; });
    series.precipitationMm = stats.map(s => s?.mean ?? null);
    series.ensemble = { memberCount: perMember.length, control, p10: stats.map(s => s?.p10 ?? null), p90: stats.map(s => s?.p90 ?? null), min: stats.map(s => s?.min ?? null), max: stats.map(s => s?.max ?? null), members: perMember };
  } else if (variables.includes(model.precipitation)) {
    const p = aggregate(model.precipitation);
    series.precipitationMm = p.map(v => v?.mean ?? null);
    series.precipitationSpread = { cellMin: p.map(v => v?.min ?? null), cellMax: p.map(v => v?.max ?? null), cellsAvailable: p.map(v => v?.n ?? 0) };
  }
  for (const layer of model.soilLayers) if (variables.includes(layer.key)) series.soil[layer.key] = { topCm: layer.topCm, bottomCm: layer.bottomCm, unit: cellList[0].hourly_units?.[layer.key] ?? 'm³/m³', values: aggregate(layer.key).map(v => v?.mean ?? null) };
  return { series, gridCells: cellList.map(c => ({ latitude: c.latitude, longitude: c.longitude, elevationM: c.elevation ?? null })), units: cellList[0]?.hourly_units ?? {} };
}
export function createOpenMeteo({ fetch, store, logger, forecastDays = 3, samplePointsPerCatchment = 9 }) {
  async function meta(model) {
    const key = `meta:${model.id}`;
    const hit = store.cache.get(key);
    if (hit) return hit.value;
    const raw = await fetch(`https://${model.host}${model.metaPath}`);
    const value = { issuedAt: raw.last_run_initialisation_time ? new Date(raw.last_run_initialisation_time * 1000).toISOString() : null, availableAt: raw.last_run_availability_time ? new Date(raw.last_run_availability_time * 1000).toISOString() : null, stepSeconds: raw.temporal_resolution_seconds ?? null, updateIntervalSeconds: raw.update_interval_seconds ?? null, dataEndTime: raw.data_end_time ? new Date(raw.data_end_time * 1000).toISOString() : null };
    store.cache.set(key, value, 300);
    return value;
  }
  async function fetchRun(catchment, model, points) {
    const params = new URLSearchParams({ latitude: points.map(p => p[1]).join(','), longitude: points.map(p => p[0]).join(','), hourly: [model.precipitation, ...model.soilLayers.map(l => l.key)].join(','), models: model.id, forecast_days: String(forecastDays), timezone: 'UTC', temporal_resolution: 'native' });
    const path = model.api === 'ensemble' ? '/v1/ensemble' : '/v1/forecast';
    const raw = await fetch(`https://${model.host}${path}?${params}`);
    const responses = Array.isArray(raw) ? raw : [raw];
    if (!responses.every(r => Array.isArray(r?.hourly?.time))) throw new Error('Provider response missing hourly series');
    return responses;
  }
  // Return the archived run for the provider's current initialisation time, fetching and archiving it if absent.
  async function latestRun(catchment, model) {
    let issued = null, metaError = null;
    try { issued = await meta(model); } catch (error) { metaError = error.message; logger?.warn('model meta unavailable', { model: model.id, error }); }
    const stored = store.forecastRuns.latest(catchment.id, model.id);
    if (stored && issued?.issuedAt && stored.issued_at === issued.issuedAt) return { ...describe(stored, model), fromArchive: true, issued };
    const points = [catchment.seedPoint, ...store.samplePoints?.(catchment.id) ?? []].slice(0, samplePointsPerCatchment);
    try {
      const retrievedAt = new Date().toISOString();
      const responses = await fetchRun(catchment, model, points);
      const { series } = aggregateRun(responses, model);
      const id = store.forecastRuns.save({ catchmentId: catchment.id, provider: 'open-meteo', model: model.id, issuedAt: issued?.issuedAt ?? null, retrievedAt, validFrom: series.times[0] ?? null, validTo: series.times.at(-1) ?? null, nativeResolution: `${model.nativeResolutionM} m grid · ${series.stepSeconds ?? issued?.stepSeconds ?? '?'} s steps`, stepSeconds: series.stepSeconds ?? issued?.stepSeconds ?? null, license: model.license, payload: { requestPoints: points, responses } });
      return { ...describe(store.forecastRuns.latest(catchment.id, model.id) || { id, payload: { responses }, issued_at: issued?.issuedAt ?? null, retrieved_at: retrievedAt }, model), fromArchive: false, issued, metaError };
    } catch (error) {
      if (stored) { logger?.warn('serving stale archived run', { model: model.id, catchment: catchment.id, error }); return { ...describe(stored, model), fromArchive: true, stale: true, issued, error: error.message }; }
      throw error;
    }
  }
  function describe(row, model) {
    const { series, gridCells, units } = aggregateRun(row.payload.responses, model);
    return { runId: row.id, model: model.id, modelName: model.name, kind: model.kind, provider: 'Open-Meteo', issuedAt: row.issued_at ?? null, retrievedAt: row.retrieved_at, validFrom: series.times[0] ?? null, validTo: series.times.at(-1) ?? null, stepSeconds: series.stepSeconds, nativeResolutionM: model.nativeResolutionM, gridCells, units, series, license: model.license, sourceUrl: model.sourceUrl, note: model.note };
  }
  return { models, meta, latestRun, aggregateRun };
}
