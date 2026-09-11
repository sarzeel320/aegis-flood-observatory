// GloFAS river discharge context (Copernicus Emergency Management Service, distributed by the Open-Meteo Flood API).
// Daily discharge at ~5 km resolution for the catchment outlet reach. Riverine context only: it is not an
// urban cloudburst footprint, not an hourly warning and not an inundation boundary.
export function createGlofas({ fetch, store, ttlSeconds = 3600, forecastDays = 7 }) {
  async function discharge(catchment) {
    const key = `glofas:${catchment.id}`;
    const hit = store.cache.get(key);
    if (hit) return { ...hit.value, cached: true };
    const [lon, lat] = catchment.outletPoint;
    const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: 'river_discharge,river_discharge_mean,river_discharge_median,river_discharge_min,river_discharge_max,river_discharge_p25,river_discharge_p75', forecast_days: String(forecastDays), timezone: 'UTC' });
    const raw = await fetch(`https://flood-api.open-meteo.com/v1/flood?${params}`);
    if (!Array.isArray(raw?.daily?.time)) throw new Error('Flood API response missing daily series');
    const value = {
      status: 'available', retrievedAt: new Date().toISOString(), issuedAt: null,
      requestPoint: { longitude: lon, latitude: lat, basis: catchment.outletReach ? `downstream end of HydroRIVERS reach ${catchment.outletReach.hyrivId} (largest upland area in the unit)` : 'catchment seed point' },
      gridPoint: { longitude: raw.longitude, latitude: raw.latitude },
      unit: raw.daily_units?.river_discharge ?? 'm³/s', nativeResolutionM: 5000, stepSeconds: 86400,
      times: raw.daily.time.map(d => `${d}T00:00Z`),
      dischargeM3S: raw.daily.river_discharge.map(v => (typeof v === 'number' ? v : null)),
      ensemble: { mean: raw.daily.river_discharge_mean ?? null, median: raw.daily.river_discharge_median ?? null, min: raw.daily.river_discharge_min ?? null, max: raw.daily.river_discharge_max ?? null, p25: raw.daily.river_discharge_p25 ?? null, p75: raw.daily.river_discharge_p75 ?? null },
      hydroRiversMeanDischargeM3S: catchment.outletReach?.meanDischargeM3S ?? null,
      provenance: { source: 'GloFAS (Copernicus Emergency Management Service) via Open-Meteo Flood API', datasetVersion: 'glofas_seamless_v4', licenseUrl: 'https://open-meteo.com/en/license', sourceUrl: 'https://open-meteo.com/en/docs/flood-api', quality: 'forecast' },
      limitations: ['Daily mean discharge on a ~5 km river network; the selected grid cell may not be the intended river.', 'Riverine context only. Not an urban cloudburst footprint, not an hourly warning, not an inundation extent.', 'GloFAS model issue time is not exposed by the distribution endpoint; issuedAt is null.']
    };
    store.cache.set(key, value, ttlSeconds);
    return { ...value, cached: false };
  }
  return { discharge };
}
