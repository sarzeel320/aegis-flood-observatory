// Terrain statistics from the Copernicus DEM as distributed by the Open-Meteo elevation API (GLO-90, 2021 release).
// This is a digital surface model sampled on a coarse grid; it supports descriptive relief/slope statistics for
// display and as model covariates. It is not hydrologically conditioned and it is not the 2024 GLO-30 edition.
import { haversineKm } from '../geo.mjs';
export const terrainProduct = { source: 'Copernicus DEM GLO-90 via Open-Meteo elevation API', edition: 'GLO-90 2021 release (90 m)', preferredEdition: 'Copernicus DEM GLO-30 2024_1 (COPERNICUS/DEM/GLO30_2024_1) for production hydrological conditioning', nativeResolutionM: 90, licenseUrl: 'https://open-meteo.com/en/docs/elevation-api', sourceLicense: 'Copernicus DEM: ESA/Airbus licence, free use with attribution', quality: 'derived', referenceYear: 2021 };
export function createTerrain({ fetch, store, catchments, ttlSeconds = 30 * 86400, maxPoints = 49 }) {
  async function terrain(catchment) {
    const key = `terrain:${catchment.id}:v1`;
    const hit = store.cache.get(key);
    if (hit) return { ...hit.value, cached: true };
    const points = catchments.samplePoints(catchment.id, maxPoints);
    const params = new URLSearchParams({ latitude: points.map(p => p[1]).join(','), longitude: points.map(p => p[0]).join(',') });
    const raw = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);
    if (!Array.isArray(raw?.elevation) || raw.elevation.length !== points.length) throw new Error('Elevation response mismatch');
    const elevations = raw.elevation.map(v => (typeof v === 'number' ? v : null));
    const valid = elevations.filter(v => v !== null);
    // Approximate slope from adjacent sample points along the grid (spacing = nearest neighbour distance).
    const slopes = [];
    for (let i = 0; i < points.length; i++) {
      if (elevations[i] === null) continue;
      let nearest = null, dist = Infinity;
      for (let j = 0; j < points.length; j++) { if (i === j || elevations[j] === null) continue; const d = haversineKm(points[i], points[j]); if (d < dist) { dist = d; nearest = j; } }
      if (nearest !== null && dist > 0) slopes.push(Math.atan(Math.abs(elevations[i] - elevations[nearest]) / (dist * 1000)) * 180 / Math.PI);
    }
    const value = {
      status: 'available', retrievedAt: new Date().toISOString(), product: terrainProduct, samplePoints: points.length, sampleSpacingKm: points.length > 1 ? Math.round(haversineKm(points[0], points[1]) * 10) / 10 : null,
      elevationM: valid.length ? { min: Math.min(...valid), mean: Math.round(valid.reduce((s, v) => s + v, 0) / valid.length), max: Math.max(...valid), reliefM: Math.max(...valid) - Math.min(...valid) } : null,
      coarseSlopeDeg: slopes.length ? { mean: Math.round(slopes.reduce((s, v) => s + v, 0) / slopes.length * 10) / 10, max: Math.round(Math.max(...slopes) * 10) / 10, note: 'Slope between sample points several kilometres apart. It understates hillslope gradients and is not a substitute for a 30 m DEM slope raster.' } : null,
      limitations: ['Sparse sample of a surface model; vegetation and buildings are included in the height.', 'Not hydrologically conditioned; do not derive channel routing from these statistics.', 'Production should ingest the 2024 GLO-30 edition and compute slope/flow direction on the full raster.']
    };
    store.cache.set(key, value, ttlSeconds);
    return { ...value, cached: false };
  }
  return { terrain };
}
