// Small GeoJSON helpers. Coordinates are [longitude, latitude] (EPSG:4326) throughout.
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
export function bboxOf(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  walk(geometry.coordinates);
  return b;
}
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function polygonsOf(geometry) { return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []; }
export function contains(geometry, point) { return polygonsOf(geometry).some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some(h => pointInRing(point, h))); }
// Spherical ring area (m²) using the signed-area formula on an equal-area-ish projection around the ring's mean latitude.
function ringAreaM2(ring) {
  let area = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [lon1, lat1] = ring[i], [lon2, lat2] = ring[(i + 1) % n];
    area += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs(area * R * R / 2);
}
export function areaKm2(geometry) { return polygonsOf(geometry).reduce((sum, [outer, ...holes]) => sum + ringAreaM2(outer) - holes.reduce((h, ring) => h + ringAreaM2(ring), 0), 0) / 1e6; }
export function centroid(geometry) {
  let sx = 0, sy = 0, sa = 0;
  for (const [outer] of polygonsOf(geometry)) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = outer.length - 1; i < n; i++) { const f = outer[i][0] * outer[i + 1][1] - outer[i + 1][0] * outer[i][1]; a += f; cx += (outer[i][0] + outer[i + 1][0]) * f; cy += (outer[i][1] + outer[i + 1][1]) * f; }
    if (a === 0) continue;
    sx += cx / 3; sy += cy / 3; sa += a;
  }
  if (sa === 0) { const b = bboxOf(geometry); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  return [sx / sa, sy / sa];
}
// Regular sample grid of points inside the geometry, at most `max` points, for raster-like lookups.
export function sampleGrid(geometry, max = 64) {
  const [minX, minY, maxX, maxY] = bboxOf(geometry);
  const points = [];
  for (let n = Math.ceil(Math.sqrt(max)); n >= 2; n--) {
    points.length = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = [minX + (i + 0.5) / n * (maxX - minX), minY + (j + 0.5) / n * (maxY - minY)];
      if (contains(geometry, p)) points.push(p);
    }
    if (points.length <= max) break;
  }
  return points;
}
export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) / 1000;
}
export function isValidLatLon(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }
export const indiaBbox = { minLat: 6, maxLat: 38, minLon: 68, maxLon: 98 };
export function inSupportedBbox(lat, lon) { return isValidLatLon(lat, lon) && lat >= indiaBbox.minLat && lat <= indiaBbox.maxLat && lon >= indiaBbox.minLon && lon <= indiaBbox.maxLon; }
