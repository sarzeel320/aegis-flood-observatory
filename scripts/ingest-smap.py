#!/usr/bin/env python3
"""Ingest NASA SMAP L4 Version 8 (SPL4SMGP) surface and root-zone soil moisture for the AEGIS catchments.

STATUS: written against the documented product layout but NOT executed in this repository, because no Earthdata
credentials were available. Treat the first run as a validation task and record its result in docs/QA.md.

Requires: EARTHDATA_TOKEN (Earthdata Login bearer token) in the environment or .env, plus
  python3 -m pip install --user h5py numpy requests
Product: SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data, Version 8
  https://nsidc.org/data/spl4smgp/versions/8  (DOI 10.5067/3CGTOEFDVVLF)
Granules are ~140 MB HDF5 files; discovery uses CMR (no credentials), download needs the bearer token.
Output: datasets/smap/<catchmentId>.json with per-timestamp catchment means of sm_surface and sm_rootzone (m³/m³),
  the cell count, and the fraction of cells with non-nominal quality flags. Values are never converted to saturation.
"""
import json, os, sys, datetime, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = os.environ.get('EARTHDATA_TOKEN', '')
if not TOKEN:
    try:
        for line in open(os.path.join(ROOT, '.env')):
            if line.startswith('EARTHDATA_TOKEN='):
                TOKEN = line.split('=', 1)[1].strip()
    except FileNotFoundError:
        pass
if not TOKEN:
    sys.exit('EARTHDATA_TOKEN is not configured. SMAP retrieval is blocked; nothing was written.')
try:
    import requests, h5py, numpy as np
except ImportError as error:
    sys.exit(f'Missing dependency: {error}. Install with: python3 -m pip install --user h5py numpy requests')

DAYS = int(os.environ.get('SMAP_DAYS', '3'))
CACHE = os.path.join(ROOT, 'data', 'smap'); os.makedirs(CACHE, exist_ok=True)
OUT = os.path.join(ROOT, 'datasets', 'smap'); os.makedirs(OUT, exist_ok=True)
catchments = json.load(open(os.path.join(ROOT, 'datasets', 'catchments.geojson')))

def discover(days):
    end = datetime.datetime.now(datetime.timezone.utc); start = end - datetime.timedelta(days=days)
    r = requests.get('https://cmr.earthdata.nasa.gov/search/granules.json', params={'short_name': 'SPL4SMGP', 'version': '008', 'temporal': f'{start.isoformat()},{end.isoformat()}', 'page_size': 200, 'sort_key': 'start_date'}, timeout=60)
    r.raise_for_status()
    out = []
    for e in r.json()['feed']['entry']:
        url = next((l['href'] for l in e.get('links', []) if l.get('rel', '').endswith('/data#') and l['href'].endswith('.h5')), None)
        if url: out.append({'id': e['producer_granule_id'], 'url': url, 'start': e['time_start'], 'end': e['time_end']})
    return out

def download(granule):
    path = os.path.join(CACHE, granule['id'])
    if os.path.exists(path): return path
    with requests.get(granule['url'], headers={'Authorization': f'Bearer {TOKEN}'}, stream=True, timeout=300, allow_redirects=True) as r:
        r.raise_for_status()
        with open(path + '.part', 'wb') as f:
            for chunk in r.iter_content(1 << 20): f.write(chunk)
    os.replace(path + '.part', path)
    return path

def point_in_ring(x, y, ring):
    inside = False
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
    return inside

def contains(geom, x, y):
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    return any(point_in_ring(x, y, p[0]) and not any(point_in_ring(x, y, h) for h in p[1:]) for p in polys)

def main():
    granules = discover(DAYS)
    if not granules: sys.exit('No SPL4SMGP granules found in the requested window.')
    per_catchment = {f['id']: {'catchmentId': f['id'], 'product': {'shortName': 'SPL4SMGP', 'version': '008', 'nativeResolutionM': 9000, 'stepSeconds': 10800, 'unit': 'm³/m³'}, 'layers': {'sm_surface': {'topCm': 0, 'bottomCm': 5, 'unit': 'm³/m³', 'values': []}, 'sm_rootzone': {'topCm': 0, 'bottomCm': 100, 'unit': 'm³/m³', 'values': []}}, 'times': [], 'qualityFlags': [], 'cellCounts': [], 'granules': [], 'provenance': {'source': 'NASA SMAP L4 SPL4SMGP', 'datasetVersion': '008', 'quality': 'derived', 'licenseUrl': 'https://nsidc.org/data/spl4smgp/versions/8', 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}} for f in catchments['features']}
    masks = None
    for g in granules:
        path = download(g)
        with h5py.File(path, 'r') as h:
            lat = h['cell_lat'][...]; lon = h['cell_lon'][...]
            surface = h['Geophysical_Data/sm_surface'][...]; rootzone = h['Geophysical_Data/sm_rootzone'][...]
            fill = h['Geophysical_Data/sm_surface'].attrs.get('_FillValue', -9999.0)
            # Quality: SMAP L4 carries per-variable uncertainty (Analysis_Data/*_analysis_ensstd) rather than bit flags;
            # we record the fraction of cells with fill values and the ensemble std where present.
            ensstd = h['Analysis_Data/sm_surface_analysis_ensstd'][...] if 'Analysis_Data/sm_surface_analysis_ensstd' in h else None
            if masks is None:
                masks = {}
                for f in catchments['features']:
                    w, s, e, n = f['bbox']
                    box = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
                    idx = np.argwhere(box)
                    inside = [tuple(ij) for ij in idx if contains(f['geometry'], float(lon[tuple(ij)]), float(lat[tuple(ij)]))]
                    masks[f['id']] = inside
            for cid, cells in masks.items():
                rec = per_catchment[cid]
                vals_s = [float(surface[c]) for c in cells if surface[c] != fill]
                vals_r = [float(rootzone[c]) for c in cells if rootzone[c] != fill]
                rec['times'].append(g['start'])
                rec['layers']['sm_surface']['values'].append(round(sum(vals_s) / len(vals_s), 4) if vals_s else None)
                rec['layers']['sm_rootzone']['values'].append(round(sum(vals_r) / len(vals_r), 4) if vals_r else None)
                rec['cellCounts'].append(len(cells))
                rec['qualityFlags'].append({'fillFraction': round(1 - len(vals_s) / len(cells), 3) if cells else None, 'surfaceEnsembleStd': round(float(np.mean([ensstd[c] for c in cells])), 4) if ensstd is not None and cells else None})
                rec['granules'].append(g['id'])
    for cid, rec in per_catchment.items():
        json.dump(rec, open(os.path.join(OUT, f'{cid}.json'), 'w'))
        print(f"{cid}: {len(rec['times'])} timestamps, {rec['cellCounts'][0] if rec['cellCounts'] else 0} cells", file=sys.stderr)

if __name__ == '__main__':
    main()
