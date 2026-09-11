// Exposure inputs: dated population from WorldPop (versioned product, polygon statistics via the WorldPop API).
// Built-up area, building counts and land cover are declared with their intended products and editions but are
// reported as not ingested until those rasters are processed; values are null, never estimated.
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const exposureProducts = {
  population: { source: 'WorldPop', product: 'Global 2000-2020 unconstrained population count, 100 m (wpgppop)', referenceYear: 2020, nativeResolutionM: 100, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://www.worldpop.org/rest-data/', citation: 'WorldPop (www.worldpop.org - School of Geography and Environmental Science, University of Southampton). DOI:10.5258/SOTON/WP00647', quality: 'derived' },
  builtUp: { source: 'GHSL', product: 'GHS-BUILT-S R2023A (built-up surface, 100 m)', referenceYear: 2020, nativeResolutionM: 100, licenseUrl: 'https://human-settlement.emergency.copernicus.eu/download.php', status: 'not-ingested', quality: 'missing' },
  buildings: { source: 'GHSL', product: 'GHS-BUILT-V R2023A (building volume) or Open Buildings v3', referenceYear: 2020, status: 'not-ingested', quality: 'missing' },
  landCover: { source: 'ESA WorldCover', product: 'WorldCover v200 10 m', referenceYear: 2021, nativeResolutionM: 10, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', status: 'not-ingested', quality: 'missing', note: '2021 reference year; not live land cover.' }
};
export function createExposure({ fetch, store, ttlSeconds = 30 * 86400, pollMs = 1500, maxPolls = 20, sleepImpl = sleep }) {
  async function population(catchment) {
    const key = `worldpop:${catchment.id}:2020`;
    const hit = store.cache.get(key);
    if (hit) return { ...hit.value, cached: true };
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: catchment.geometry }] });
    const form = new URLSearchParams({ dataset: 'wpgppop', year: '2020', geojson });
    let result = await fetch('https://api.worldpop.org/v1/services/stats', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    for (let i = 0; i < maxPolls && result?.status !== 'finished'; i++) { await sleepImpl(pollMs); result = await fetch(`https://api.worldpop.org/v1/tasks/${encodeURIComponent(result.taskid)}`); }
    if (result?.status !== 'finished') throw new Error('WorldPop statistics task did not finish');
    if (result.error) throw new Error(`WorldPop error: ${result.error_message}`);
    const total = Number(result.data?.total_population);
    if (!Number.isFinite(total)) throw new Error('WorldPop returned no population value');
    const value = { status: 'available', retrievedAt: new Date().toISOString(), taskId: result.taskid, totalPopulation: Math.round(total), densityPerKm2: Math.round(total / catchment.computedAreaKm2), ...exposureProducts.population, uncertainty: null, uncertaintyNote: 'The unconstrained WorldPop product does not publish per-polygon uncertainty. Treat totals as ±(unknown); do not double count with building-based estimates.' };
    store.cache.set(key, value, ttlSeconds);
    return { ...value, cached: false };
  }
  return { population, products: exposureProducts };
}
