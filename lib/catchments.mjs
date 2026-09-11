// Authoritative catchment registry loaded from datasets/catchments.geojson and datasets/rivers.geojson
// (produced by scripts/ingest-catchments.mjs from HydroBASINS / HydroRIVERS).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bboxOf, centroid, areaKm2, sampleGrid } from './geo.mjs';

export function loadCatchments(root) {
  const catchmentsPath = join(root, 'datasets', 'catchments.geojson');
  const riversPath = join(root, 'datasets', 'rivers.geojson');
  if (!existsSync(catchmentsPath)) throw new Error('datasets/catchments.geojson is missing. Run: node scripts/ingest-catchments.mjs --hydro <dir>');
  const collection = JSON.parse(readFileSync(catchmentsPath, 'utf8'));
  const riversCollection = existsSync(riversPath) ? JSON.parse(readFileSync(riversPath, 'utf8')) : { features: [], provenance: null };
  const byId = new Map();
  for (const feature of collection.features) {
    const p = feature.properties;
    const reaches = riversCollection.features.filter(r => r.properties.catchmentId === p.id);
    const mainReach = reaches.reduce((best, r) => (!best || (r.properties.uplandKm2 ?? 0) > (best.properties.uplandKm2 ?? 0) ? r : best), null);
    const line = mainReach ? (mainReach.geometry.type === 'LineString' ? mainReach.geometry.coordinates : mainReach.geometry.coordinates.at(-1)) : null;
    byId.set(p.id, {
      id: p.id, name: p.name, state: p.state, group: p.group, riverName: p.riverName,
      hybasId: p.hybasId, pfafId: p.pfafId, level: p.level, nextDown: p.nextDown, mainBasin: p.mainBasin, upstreamUnits: p.upstreamUnits, downstreamUnit: p.downstreamUnit,
      subAreaKm2: p.subAreaKm2, upstreamAreaKm2: p.upstreamAreaKm2, endorheic: p.endorheic, coastal: p.coastal,
      edition: collection.edition, spatialReference: collection.spatialReference,
      geometry: feature.geometry, bbox: feature.bbox || bboxOf(feature.geometry), centroid: centroid(feature.geometry), computedAreaKm2: Math.round(areaKm2(feature.geometry) * 10) / 10,
      seedPoint: p.seedPoint.coordinates, // [lon, lat]
      outletPoint: line ? line.at(-1) : p.seedPoint.coordinates, outletReach: mainReach ? { hyrivId: mainReach.properties.hyrivId, uplandKm2: mainReach.properties.uplandKm2, meanDischargeM3S: mainReach.properties.meanDischargeM3S, strahlerOrder: mainReach.properties.strahlerOrder } : null,
      reachCount: reaches.length, reaches
    });
  }
  const summary = c => ({ id: c.id, name: c.name, state: c.state, group: c.group, riverName: c.riverName, hybasId: c.hybasId, pfafId: c.pfafId, level: c.level, nextDown: c.nextDown, mainBasin: c.mainBasin, upstreamUnits: c.upstreamUnits, downstreamUnit: c.downstreamUnit, subAreaKm2: c.subAreaKm2, upstreamAreaKm2: c.upstreamAreaKm2, computedAreaKm2: c.computedAreaKm2, endorheic: c.endorheic, coastal: c.coastal, edition: c.edition, spatialReference: c.spatialReference, bbox: c.bbox, centroid: c.centroid, seedPoint: c.seedPoint, outletPoint: c.outletPoint, outletReach: c.outletReach, reachCount: c.reachCount });
  return {
    edition: collection.edition, spatialReference: collection.spatialReference, generatedAt: collection.generatedAt,
    provenance: { catchments: collection.provenance, rivers: riversCollection.provenance },
    ids: () => [...byId.keys()],
    list: () => [...byId.values()].map(summary),
    get: id => byId.get(id) || null,
    summary,
    feature: c => ({ type: 'Feature', id: c.id, bbox: c.bbox, geometry: c.geometry, properties: summary(c) }),
    riversFor: id => ({ type: 'FeatureCollection', catchmentId: id, edition: riversCollection.edition, spatialReference: riversCollection.spatialReference, provenance: riversCollection.provenance, features: byId.get(id)?.reaches || [] }),
    samplePoints: (id, max = 16) => sampleGrid(byId.get(id).geometry, max)
  };
}
