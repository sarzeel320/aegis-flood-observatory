#!/usr/bin/env python3
"""Process the Groundsource historical flood-event dataset into catchment labels.

Groundsource: Mayo et al. (2026), Zenodo record 18647054, CC BY 4.0. 2,646,302 news-derived flood events with
WKB polygon geometry (EPSG:4326), start_date, end_date, area_km2 and a uuid.

Steps: verify checksum → inspect schema → spatially intersect with the ten AEGIS catchments → keep source identifiers →
deduplicate overlapping reports per catchment → write datasets/labels/groundsource_events.json.
Absence of a report is NEVER written as a negative label; unlabeled days stay unlabeled.

Requires: python3 -m pip install --user duckdb  (the DuckDB spatial extension is installed on first run).
"""
import duckdb, hashlib, json, os, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARQUET = os.environ.get('GROUNDSOURCE_PARQUET', os.path.join(ROOT, 'data', 'groundsource_2026.parquet'))
EXPECTED_MD5 = 'cd1b5de6508f7aad8e1d1d0dd4cecea6'  # from https://zenodo.org/api/records/18647054/files
OUT_DIR = os.path.join(ROOT, 'datasets', 'labels')

def to_wkt(geometry):
    ring = lambda r: '(' + ', '.join(f'{float(x)} {float(y)}' for x, y in r) + ')'
    poly = lambda p: '(' + ', '.join(ring(r) for r in p) + ')'
    if geometry['type'] == 'Polygon':
        return 'POLYGON ' + poly(geometry['coordinates'])
    return 'MULTIPOLYGON (' + ', '.join(poly(p) for p in geometry['coordinates']) + ')'

def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 22), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    if not os.path.exists(PARQUET):
        sys.exit(f'Missing {PARQUET}. Download from https://zenodo.org/records/18647054 (667,122,400 bytes).')
    size = os.path.getsize(PARQUET)
    checksum = md5(PARQUET)
    if checksum != EXPECTED_MD5:
        sys.exit(f'Checksum mismatch for {PARQUET}: {checksum} != {EXPECTED_MD5}. The file is incomplete or altered.')
    catchments = json.load(open(os.path.join(ROOT, 'datasets', 'catchments.geojson')))
    con = duckdb.connect()
    con.execute('INSTALL spatial; LOAD spatial;')
    # The file carries no GeoParquet geometry-type metadata; read the geometry column as raw WKB bytes.
    con.execute('SET enable_geoparquet_conversion = false;')
    schema = con.execute(f"DESCRIBE SELECT * FROM '{PARQUET}'").fetchall()
    total = con.execute(f"SELECT COUNT(*) FROM '{PARQUET}'").fetchone()[0]
    date_range = con.execute(f"SELECT MIN(start_date), MAX(end_date) FROM '{PARQUET}'").fetchone()
    # India bounding box context (not a label set): events intersecting the supported bbox.
    india_bbox = con.execute(f"SELECT COUNT(*) FROM '{PARQUET}' WHERE ST_Intersects(ST_GeomFromWKB(geometry), ST_MakeEnvelope(68, 6, 98, 38))").fetchone()[0]
    events_by_catchment = {}
    for feature in catchments['features']:
        cid = feature['id']
        # Inline WKT (numeric coordinates generated here, never user input). Parameterised geometry binding
        # segfaults in duckdb-spatial 1.4.x on this platform; inline literals work.
        wkt = to_wkt(feature['geometry'])
        rows = con.execute(f"""
            SELECT uuid, start_date, end_date, area_km2,
                   ST_Area(ST_Intersection(ST_GeomFromWKB(geometry), ST_GeomFromText('{wkt}'))) / NULLIF(ST_Area(ST_GeomFromWKB(geometry)), 0) AS fraction_of_event_in_catchment,
                   ST_Area(ST_Intersection(ST_GeomFromWKB(geometry), ST_GeomFromText('{wkt}'))) / NULLIF(ST_Area(ST_GeomFromText('{wkt}')), 0) AS fraction_of_catchment_covered
            FROM '{PARQUET}'
            WHERE ST_Intersects(ST_GeomFromWKB(geometry), ST_GeomFromText('{wkt}'))
            ORDER BY start_date
        """).fetchall()
        catchment_area = feature['properties']['subAreaKm2']
        events = []
        for uuid, start, end, area, frac_event, frac_catch in rows:
            # Label quality tiers: 'local' = report footprint is comparable to the catchment and mostly inside it;
            # 'regional' = large-area report (state/district scale) that merely overlaps the catchment.
            tier = 'local' if (area is not None and area <= 5 * catchment_area and (frac_event or 0) >= 0.3) else 'regional'
            events.append({'uuid': uuid, 'startDate': start, 'endDate': end, 'eventAreaKm2': round(area, 2) if area is not None else None, 'fractionOfEventInCatchment': round(frac_event, 4) if frac_event is not None else None, 'fractionOfCatchmentCovered': round(frac_catch, 4) if frac_catch is not None else None, 'tier': tier})
        # Deduplicate: merge reports of the same tier whose date windows overlap or touch (±1 day).
        merged = []
        for e in events:
            s = datetime.date.fromisoformat(e['startDate']); t = datetime.date.fromisoformat(e['endDate'])
            target = None
            for m in merged:
                if m['tier'] != e['tier']: continue
                ms = datetime.date.fromisoformat(m['startDate']); mt = datetime.date.fromisoformat(m['endDate'])
                if s <= mt + datetime.timedelta(days=1) and t >= ms - datetime.timedelta(days=1):
                    target = m; break
            if target is None:
                merged.append({**e, 'sourceUuids': [e['uuid']], 'reportCount': 1}); merged[-1].pop('uuid')
            else:
                target['sourceUuids'].append(e['uuid']); target['reportCount'] += 1
                target['startDate'] = min(target['startDate'], e['startDate']); target['endDate'] = max(target['endDate'], e['endDate'])
                if (e['fractionOfEventInCatchment'] or 0) > (target['fractionOfEventInCatchment'] or 0):
                    target['fractionOfEventInCatchment'] = e['fractionOfEventInCatchment']; target['eventAreaKm2'] = e['eventAreaKm2']
        events_by_catchment[cid] = {'catchmentId': cid, 'name': feature['properties']['name'], 'hybasId': feature['properties']['hybasId'], 'catchmentAreaKm2': catchment_area, 'rawReports': len(events), 'events': merged, 'localEvents': sum(1 for m in merged if m['tier'] == 'local'), 'regionalEvents': sum(1 for m in merged if m['tier'] == 'regional')}
        print(f"{cid:14} reports {len(events):5d} → events {len(merged):5d} (local {events_by_catchment[cid]['localEvents']}, regional {events_by_catchment[cid]['regionalEvents']})", file=sys.stderr)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {
        'dataset': {'name': 'Groundsource: A Dataset of Flood Events from News', 'zenodoRecord': 'https://zenodo.org/records/18647054', 'doi': '10.5281/zenodo.18647054', 'license': 'CC BY 4.0', 'file': os.path.basename(PARQUET), 'sizeBytes': size, 'md5': checksum, 'rows': total, 'schema': [{'column': c[0], 'type': c[1]} for c in schema], 'spatialEncoding': 'WKB polygons/multipolygons, EPSG:4326 longitude/latitude', 'dateRange': list(date_range), 'eventsIntersectingIndiaBbox': india_bbox},
        'processedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'method': {'intersection': 'ST_Intersects between event WKB geometry and HydroBASINS level-8 catchment polygon (DuckDB spatial)', 'tiers': "local: event area ≤ 5× catchment area and ≥30% of the event lies inside the catchment; regional: otherwise", 'deduplication': 'reports of the same tier with overlapping or adjacent (±1 day) date windows are merged; all source uuids retained', 'negatives': 'NOT generated. Days without a report are unlabeled, not negative. News coverage bias is unquantified.'},
        'catchments': events_by_catchment
    }
    json.dump(out, open(os.path.join(OUT_DIR, 'groundsource_events.json'), 'w'), indent=1)
    print(f"Wrote {os.path.join(OUT_DIR, 'groundsource_events.json')}", file=sys.stderr)

if __name__ == '__main__':
    main()
