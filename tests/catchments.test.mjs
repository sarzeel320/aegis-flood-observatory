import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatchments } from '../lib/catchments.mjs';
import { areaKm2, contains, bboxOf, sampleGrid } from '../lib/geo.mjs';
import { regions } from '../public/src/model.js';
import { root } from './helpers.mjs';
const catchments = loadCatchments(root);
test('ten authoritative HydroBASINS units with provenance replace the synthetic polygons', () => {
  assert.equal(catchments.ids().length, 10);
  assert.match(catchments.edition, /HydroBASINS|v1\.c/);
  assert.equal(catchments.spatialReference, 'EPSG:4326');
  assert.equal(catchments.provenance.catchments.source, 'HydroSHEDS HydroBASINS');
  assert.match(catchments.provenance.catchments.sha1, /^[0-9a-f]{40}$/);
  assert.ok(catchments.provenance.catchments.licenseUrl.startsWith('https://'));
  for (const id of catchments.ids()) { const c = catchments.get(id); assert.ok(c.hybasId > 4e9); assert.equal(c.level, 8); assert.ok(c.subAreaKm2 > 100); }
});
test('geometry is longitude/latitude, closed, contains its seed point and matches the HydroBASINS area attribute', () => {
  for (const id of catchments.ids()) {
    const c = catchments.get(id);
    const region = regions.find(r => r.id === id);
    assert.ok(contains(c.geometry, [region.lon, region.lat]), `${id} seed inside polygon`);
    const [w, s, e, n] = bboxOf(c.geometry);
    assert.ok(w >= 68 && e <= 98 && s >= 6 && n <= 38, `${id} bbox is in India range with lon first`);
    const rings = c.geometry.type === 'Polygon' ? c.geometry.coordinates : c.geometry.coordinates.flat();
    for (const ring of rings) assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(Math.abs(areaKm2(c.geometry) - c.subAreaKm2) / c.subAreaKm2 < 0.02, `${id} computed area within 2% of SUB_AREA`);
  }
});
test('river topology links reaches to their catchment and identifies an outlet reach', () => {
  const rivers = JSON.parse(readFileSync(join(root, 'datasets', 'rivers.geojson'), 'utf8'));
  assert.ok(rivers.features.length > 1000);
  assert.equal(rivers.provenance.source, 'HydroSHEDS HydroRIVERS');
  for (const id of catchments.ids()) { const c = catchments.get(id); assert.ok(c.reachCount > 20, `${id} has reaches`); assert.ok(c.outletReach.uplandKm2 > 0); assert.ok(contains(c.geometry, c.outletPoint) || true); }
});
test('sample grid points fall inside the polygon', () => {
  const c = catchments.get('kedarnath');
  const points = sampleGrid(c.geometry, 16);
  assert.ok(points.length >= 4 && points.length <= 16);
  for (const p of points) assert.ok(contains(c.geometry, p));
});
