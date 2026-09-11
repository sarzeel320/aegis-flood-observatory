#!/usr/bin/env node
// Emit SQL that loads the ingested catchments and river reaches into the PostGIS schema (lib/store/postgis.sql).
// Usage: node scripts/export-postgis.mjs | psql "$DATABASE_URL"
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const catchments = JSON.parse(readFileSync(join(root, 'datasets', 'catchments.geojson'), 'utf8'));
const rivers = JSON.parse(readFileSync(join(root, 'datasets', 'rivers.geojson'), 'utf8'));
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const geo = g => `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${q(JSON.stringify(g))}), 4326))`;
const out = ['BEGIN;'];
for (const f of catchments.features) {
  const p = f.properties;
  out.push(`INSERT INTO catchments (id, name, state, region_group, hybas_id, pfaf_id, level, next_down, main_basin, sub_area_km2, upstream_area_km2, edition, source_sha1, license_url, retrieved_at, seed_point, geom) VALUES (${q(p.id)}, ${q(p.name)}, ${q(p.state)}, ${q(p.group)}, ${p.hybasId}, ${p.pfafId}, ${p.level}, ${q(p.nextDown)}, ${p.mainBasin}, ${p.subAreaKm2}, ${p.upstreamAreaKm2}, ${q(catchments.edition)}, ${q(catchments.provenance.sha1)}, ${q(catchments.provenance.licenseUrl)}, ${q(catchments.provenance.retrievedAt)}, ST_SetSRID(ST_MakePoint(${p.seedPoint.coordinates[0]}, ${p.seedPoint.coordinates[1]}), 4326), ${geo(f.geometry)}) ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, edition = EXCLUDED.edition, retrieved_at = EXCLUDED.retrieved_at;`);
}
for (const r of rivers.features) {
  const p = r.properties;
  out.push(`INSERT INTO river_reaches (hyriv_id, catchment_id, next_down, main_river, length_km, upland_km2, mean_discharge_m3s, strahler_order, edition, geom) VALUES (${p.hyrivId}, ${q(p.catchmentId)}, ${q(p.nextDown)}, ${q(p.mainRiver)}, ${q(p.lengthKm)}, ${q(p.uplandKm2)}, ${q(p.meanDischargeM3S)}, ${q(p.strahlerOrder)}, ${q(rivers.edition)}, ${geo(r.geometry)}) ON CONFLICT (hyriv_id) DO NOTHING;`);
}
out.push('COMMIT;');
process.stdout.write(out.join('\n') + '\n');
