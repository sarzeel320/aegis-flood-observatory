#!/usr/bin/env node
// Ingest authoritative catchment boundaries (HydroBASINS v1.c, level 8) and river topology (HydroRIVERS v1.0)
// for the AEGIS study sites. Produces datasets/catchments.geojson and datasets/rivers.geojson with provenance.
//
// Usage: node scripts/ingest-catchments.mjs --hydro <dir with hybas_as_lev08_v1c.* and HydroRIVERS_v10_as_shp/>
// Source downloads (HydroSHEDS, https://www.hydrosheds.org, license https://www.hydrosheds.org/page/license):
//   https://data.hydrosheds.org/file/HydroBASINS/standard/hybas_as_lev08_v1c.zip
//   https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShapes, readDbf, readPrj, pointInGeometry, inBbox } from './shapefile.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const hydroDir = resolve(args.hydro || process.env.HYDRO_DIR || 'data/hydrosheds');
const basinsBase = join(hydroDir, 'hybas_as_lev08_v1c');
const riversBase = join(hydroDir, 'HydroRIVERS_v10_as_shp', 'HydroRIVERS_v10_as');
const seeds = JSON.parse(readFileSync(join(root, 'datasets', 'seeds.json'), 'utf8')).sites;
const sha1 = path => createHash('sha1').update(readFileSync(path)).digest('hex');
const retrievedAt = new Date().toISOString();

console.error('Reading HydroBASINS attributes…');
const basinAttrs = readDbf(`${basinsBase}.dbf`);
console.error(`  ${basinAttrs.recordCount} level-8 units`);
const crs = readPrj(`${basinsBase}.prj`);

// Pass 1: find the basin polygon containing each seed point.
const selected = new Map(); // hybasId -> { seed, geometry, attrs, bbox }
console.error('Scanning HydroBASINS geometry…');
for (const shape of readShapes(`${basinsBase}.shp`)) {
  if (!shape.geometry) continue;
  for (const seed of seeds) {
    const point = [seed.lon, seed.lat];
    if (inBbox(point, shape.bbox) && pointInGeometry(point, shape.geometry)) {
      const attrs = basinAttrs.records[shape.index];
      if (selected.has(attrs.HYBAS_ID)) throw new Error(`Seeds ${seed.id} and ${selected.get(attrs.HYBAS_ID).seed.id} fall in the same basin ${attrs.HYBAS_ID}`);
      selected.set(attrs.HYBAS_ID, { seed, geometry: shape.geometry, attrs, bbox: shape.bbox });
    }
  }
}
for (const seed of seeds) if (![...selected.values()].some(s => s.seed.id === seed.id)) throw new Error(`No level-8 basin contains seed ${seed.id}`);

// Upstream units: level-8 units whose NEXT_DOWN is a selected unit (one hop). Downstream unit id kept as a link.
const byId = new Map(basinAttrs.records.map(r => [r.HYBAS_ID, r]));
const upstream = new Map([...selected.keys()].map(id => [id, basinAttrs.records.filter(r => r.NEXT_DOWN === id).map(r => r.HYBAS_ID)]));

// Pass 2: rivers whose midpoint lies inside a selected unit.
console.error('Reading HydroRIVERS attributes (filtered)…');
const unionBbox = [...selected.values()].reduce((b, s) => [Math.min(b[0], s.bbox[0]), Math.min(b[1], s.bbox[1]), Math.max(b[2], s.bbox[2]), Math.max(b[3], s.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
const riverAttrs = readDbf(`${riversBase}.dbf`); // full read: ~1.4M rows, needed for index alignment
console.error('Scanning HydroRIVERS geometry…');
const rivers = [];
for (const shape of readShapes(`${riversBase}.shp`)) {
  if (!shape.geometry || !(shape.bbox[2] >= unionBbox[0] && shape.bbox[0] <= unionBbox[2] && shape.bbox[3] >= unionBbox[1] && shape.bbox[1] <= unionBbox[3])) continue;
  const line = shape.geometry.type === 'LineString' ? shape.geometry.coordinates : shape.geometry.coordinates.flat();
  const mid = line[Math.floor(line.length / 2)];
  for (const [hybasId, unit] of selected) {
    if (inBbox(mid, unit.bbox) && pointInGeometry(mid, unit.geometry)) {
      const a = riverAttrs.records[shape.index];
      rivers.push({ type: 'Feature', id: `hyriv-${a.HYRIV_ID}`, geometry: shape.geometry, properties: { hyrivId: a.HYRIV_ID, nextDown: a.NEXT_DOWN, mainRiver: a.MAIN_RIV, catchmentId: unit.seed.id, hybasId, lengthKm: a.LENGTH_KM, distDownKm: a.DIST_DN_KM, distUpKm: a.DIST_UP_KM, reachCatchmentKm2: a.CATCH_SKM, uplandKm2: a.UPLAND_SKM, endorheic: a.ENDORHEIC === 1, meanDischargeM3S: a.DIS_AV_CMS, strahlerOrder: a.ORD_STRA, orderClass: a.ORD_CLAS, flowOrder: a.ORD_FLOW, hybasL12: a.HYBAS_L12 } });
      break;
    }
  }
}
console.error(`  ${rivers.length} reaches inside selected units`);

const provenance = {
  catchments: { source: 'HydroSHEDS HydroBASINS', datasetVersion: 'v1.c (level 8, Asia, 2014 release)', file: 'hybas_as_lev08_v1c.zip', sha1: sha1(`${basinsBase}.shp`), sizeBytes: statSync(`${basinsBase}.shp`).size, retrievedAt, crs: 'EPSG:4326 (WGS 84, longitude/latitude)', crsWkt: crs, licenseUrl: 'https://www.hydrosheds.org/page/license', citation: 'Lehner, B., Grill G. (2013). Global river hydrography and network routing: baseline data and new approaches to study the world\'s large river systems. Hydrological Processes, 27(15): 2171–2186.', quality: 'observed', notes: 'Level-8 sub-basin units derived from 15 arc-second HydroSHEDS elevation data. They are hydrological units, not administrative districts, and they are not flood inundation extents.' },
  rivers: { source: 'HydroSHEDS HydroRIVERS', datasetVersion: 'v1.0 (Asia, 2019 release)', file: 'HydroRIVERS_v10_as_shp.zip', sha1: sha1(`${riversBase}.shp`), sizeBytes: statSync(`${riversBase}.shp`).size, retrievedAt, crs: 'EPSG:4326 (WGS 84, longitude/latitude)', licenseUrl: 'https://www.hydrosheds.org/page/license', citation: 'Lehner, B., Grill G. (2013).', quality: 'observed', notes: 'Reaches with upstream area ≥10 km² or average flow ≥0.1 m³/s. DIS_AV_CMS is a long-term modelled average, not a live gauge.' }
};

const features = [...selected.values()].map(({ seed, geometry, attrs, bbox }) => ({
  type: 'Feature', id: seed.id, bbox, geometry,
  properties: {
    id: seed.id, name: seed.name, state: seed.state, group: seed.group, riverName: seed.river,
    hybasId: attrs.HYBAS_ID, pfafId: attrs.PFAF_ID, level: 8, nextDown: attrs.NEXT_DOWN || null, nextSink: attrs.NEXT_SINK, mainBasin: attrs.MAIN_BAS,
    subAreaKm2: attrs.SUB_AREA, upstreamAreaKm2: attrs.UP_AREA, distanceToSinkKm: attrs.DIST_SINK, distanceToMainKm: attrs.DIST_MAIN, endorheic: attrs.ENDO !== 0, coastal: attrs.COAST === 1, order: attrs.ORDER,
    upstreamUnits: upstream.get(attrs.HYBAS_ID), downstreamUnit: byId.get(attrs.NEXT_DOWN) ? { hybasId: attrs.NEXT_DOWN, subAreaKm2: byId.get(attrs.NEXT_DOWN).SUB_AREA } : null,
    seedPoint: { type: 'Point', coordinates: [seed.lon, seed.lat] },
    reachCount: rivers.filter(r => r.properties.catchmentId === seed.id).length,
    edition: provenance.catchments.datasetVersion, spatialReference: 'EPSG:4326'
  }
}));

mkdirSync(join(root, 'datasets'), { recursive: true });
writeFileSync(join(root, 'datasets', 'catchments.geojson'), JSON.stringify({ type: 'FeatureCollection', name: 'aegis-catchments', edition: provenance.catchments.datasetVersion, spatialReference: 'EPSG:4326', generatedAt: retrievedAt, provenance: provenance.catchments, features }));
writeFileSync(join(root, 'datasets', 'rivers.geojson'), JSON.stringify({ type: 'FeatureCollection', name: 'aegis-rivers', edition: provenance.rivers.datasetVersion, spatialReference: 'EPSG:4326', generatedAt: retrievedAt, provenance: provenance.rivers, features: rivers }));
writeFileSync(join(root, 'datasets', 'provenance.json'), JSON.stringify(provenance, null, 2));
for (const f of features) console.error(`${f.properties.id.padEnd(14)} HYBAS ${f.properties.hybasId} sub ${f.properties.subAreaKm2} km² up ${f.properties.upstreamAreaKm2} km² reaches ${f.properties.reachCount} upstream units ${f.properties.upstreamUnits.length}`);
console.error('Wrote datasets/catchments.geojson, datasets/rivers.geojson, datasets/provenance.json');
