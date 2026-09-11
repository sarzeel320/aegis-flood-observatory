# AEGIS delivery manifest

The handoff archive is `AEGIS-source.zip`. It contains the frontend, the catchment-intelligence backend, ingestion and training scripts, derived datasets small enough to ship, tests and documentation.

Included:

- `public/` — observatory UI (`index.html`, `styles.css`, `research.html`), `src/app.js`, `src/globe.js`, `src/model.js`, `src/catalog.js`, `src/comparison.js`, `src/places.js`; `public/vendor/maplibre-gl/` (MapLibre GL JS 6.9.0, BSD-3-Clause).
- `server.mjs`, `lib/` — application, config, logging, router, outbound fetch, SQLite store, PostGIS schema, providers, forecast assembly, model status, notifications, `/api/v1` routes, comparison calculations.
- `scripts/` — `shapefile.mjs`, `ingest-catchments.mjs`, `ingest-power.mjs`, `ingest-history.mjs`, `archive-forecasts.mjs`, `export-postgis.mjs`, `train-baseline.mjs`, `groundsource.py`, `ingest-smap.py`.
- `datasets/` — `seeds.json`, `catchments.geojson`, `rivers.geojson`, `provenance.json`, `labels/groundsource_events.json`, `model/metrics.json`, `model/weights.json`.
- `docs/` — `API.md`, `BACKEND_HANDOFF.md`, `BACKEND_COMPLETION_PROMPT.md`, `MODEL_CARD.md`, `RESEARCH.md`, `QA.md`, `DELIVERY_MANIFEST.md`.
- `tests/` — foundation, catchments, providers, API contract/failure/notification, forecast interval and demonstration-index tests.
- `README.md`, `.env.example`, `.gitignore`, `Start AEGIS.command`, `package.json`.

Excluded:

- `.env` and any token.
- `data/` — raw downloads: `groundsource_2026.parquet` (667,122,400 bytes, MD5 `cd1b5de6508f7aad8e1d1d0dd4cecea6`), HydroSHEDS zips, `aegis.sqlite`. Re-download with the URLs and checksums in `docs/RESEARCH.md`.
- `datasets/history/` — NASA POWER feature files (~8 MB); regenerate with `npm run ingest:history` (24 seconds).
- `node_modules`, logs, temporary files.

Definition-of-done check (see `docs/QA.md` for evidence):

| Item | State |
|---|---|
| Five `/api/v1` contracts implemented and documented | Done (`docs/API.md`) |
| One authoritative catchment geometry edition and one versioned weather source live | Done: HydroBASINS v1.c level 8; ECMWF IFS/AIFS runs archived by initialisation time |
| Soil data with units/depth/quality metadata; soil ablation with held-out metrics | Done for model soil layers (m³/m³, depth ranges, flags) and ERA5-Land; SMAP L4 metadata declared, retrieval blocked on credentials; ablation in `docs/MODEL_CARD.md` |
| Model card states what is and is not validated | Done |
| Frontend displays provenance, missingness, model status and uncertainty | Done (edition line, source statuses, catchment forecast panel with ensemble P10–P90, quality-flag count, null probability) |
| No synthetic footprint, exposure, refuge or score presented as a warning | Done: footprints replaced by real boundaries, exposure from WorldPop, refuge marker removed, index labeled demonstration |
| Notification sends disabled until consent, authority and provider checks complete | Done: `NOTIFICATION_SENDS_ENABLED=false`, no provider adapter exists |
| Tests, failure paths, final ZIP and README updated | Done |
