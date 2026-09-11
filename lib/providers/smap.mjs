// NASA SMAP L4 Version 8 (SPL4SMGP) surface and root-zone soil moisture.
// Granule discovery uses the public CMR search (no credentials). Retrieval of the ~140 MB HDF5 granules requires an
// Earthdata bearer token and is performed by scripts/ingest-smap.py, which writes datasets/smap/<catchmentId>.json.
// This adapter never fabricates soil values: without an ingested file the series is null with quality 'missing'.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export const smapProduct = { shortName: 'SPL4SMGP', version: '008', name: 'SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data V008', nativeResolutionM: 9000, stepSeconds: 10800, unit: 'm³/m³', layers: [{ key: 'sm_surface', topCm: 0, bottomCm: 5 }, { key: 'sm_rootzone', topCm: 0, bottomCm: 100 }], licenseUrl: 'https://nsidc.org/data/spl4smgp/versions/8', doi: '10.5067/3CGTOEFDVVLF', citation: 'Reichle, R. H. et al. SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture, Version 8. NASA NSIDC DAAC.' };
export function createSmap({ fetch, store, config, root, ttlSeconds = 3600 }) {
  async function latestGranules(limit = 3) {
    const key = 'smap:granules';
    const hit = store.cache.get(key);
    if (hit) return hit.value;
    const end = new Date(), start = new Date(end.getTime() - 10 * 86400000);
    const params = new URLSearchParams({ short_name: smapProduct.shortName, version: smapProduct.version, temporal: `${start.toISOString()},${end.toISOString()}`, page_size: String(limit), sort_key: '-start_date' });
    const raw = await fetch(`https://cmr.earthdata.nasa.gov/search/granules.json?${params}`);
    const value = (raw?.feed?.entry ?? []).map(e => ({ granuleId: e.producer_granule_id, conceptId: e.id, timeStart: e.time_start, timeEnd: e.time_end, updated: e.updated, sizeMB: Number(e.granule_size) || null, dataUrl: e.links?.find(l => l.rel?.endsWith('/data#') && l.href?.endsWith('.h5'))?.href ?? null }));
    store.cache.set(key, value, ttlSeconds);
    return value;
  }
  function ingested(catchmentId) {
    const path = join(root, 'datasets', 'smap', `${catchmentId}.json`);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  }
  async function status() {
    let granules = [], discoveryError = null;
    try { granules = await latestGranules(); } catch (error) { discoveryError = error.message; }
    return { product: smapProduct, credentials: config.EARTHDATA_TOKEN ? 'configured' : 'not configured', retrieval: config.EARTHDATA_TOKEN ? 'possible via scripts/ingest-smap.py' : 'blocked: EARTHDATA_TOKEN missing', discovery: discoveryError ? { status: 'unavailable', error: discoveryError } : { status: 'available', latestGranules: granules }, latency: granules[0]?.timeStart ? `${Math.round((Date.now() - Date.parse(granules[0].timeStart)) / 3600000)} h since latest granule start` : null };
  }
  function series(catchment) {
    const file = ingested(catchment.id);
    if (!file) return { status: 'missing', reason: config.EARTHDATA_TOKEN ? 'No ingested SMAP file for this catchment. Run scripts/ingest-smap.py.' : 'Earthdata credentials are not configured; SMAP L4 has not been ingested.', product: smapProduct, times: [], layers: Object.fromEntries(smapProduct.layers.map(l => [l.key, { ...l, unit: smapProduct.unit, values: [] }])), qualityFlags: [], provenance: { source: 'NASA SMAP L4 SPL4SMGP', datasetVersion: '008', quality: 'missing', licenseUrl: smapProduct.licenseUrl } };
    return { status: 'available', ...file };
  }
  return { status, series, latestGranules, product: smapProduct };
}
