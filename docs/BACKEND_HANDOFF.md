# AEGIS backend handoff

## Objective

Preserve the existing frontend and replace its synthetic signals with traceable, versioned catchment intelligence. The service is a dependency-free Node.js (≥22.13) application; the option of moving to FastAPI was evaluated and rejected because it would have added implementation risk without changing the HTTP contracts. `lib/app.mjs` is the composition root, `server.mjs` the entry point.

## Status table (11 September 2026)

| Area | Status | Evidence |
|---|---|---|
| Catchment geometry | **Live, authoritative.** Ten HydroBASINS v1.c level-8 units (SHA-1 recorded) replace the ten synthetic polygons | `datasets/catchments.geojson`, `scripts/ingest-catchments.mjs`; computed areas match `SUB_AREA` to <0.1% |
| River topology | **Live.** 2,140 HydroRIVERS v1.0 reaches with `NEXT_DOWN`, Strahler order, upland area; outlet reach per unit | `datasets/rivers.geojson`, `/api/v1/catchments/:id/rivers` |
| Weather runs | **Live, archived per initialisation time.** ECMWF IFS 0.25° (3 h native, four soil layers), ECMWF AIFS Single (6 h), Google WeatherNext 2 ensemble (6 h, 63 members) via Open-Meteo | `forecast_runs` table, `lib/providers/openmeteo.mjs` |
| Riverine discharge | **Live, context only.** GloFAS v4 daily at the outlet reach | `lib/providers/glofas.mjs` |
| Soil moisture (SMAP L4 v8) | **Discovery live, retrieval blocked.** CMR granule search works without credentials; download needs `EARTHDATA_TOKEN`; `scripts/ingest-smap.py` is written but unexecuted | `/api/v1/sources` → `soil` |
| Terrain | **Live, coarse.** Copernicus DEM GLO-90 (2021) sampled via Open-Meteo elevation API | `lib/providers/terrain.mjs` |
| Population | **Live, dated.** WorldPop 2020 unconstrained 100 m, polygon statistics | `lib/providers/exposure.mjs` |
| Built-up, buildings, land cover | **Declared, not ingested.** GHS-BUILT-S R2023A, WorldCover v200 (2021) named with editions; values null | `/api/v1/catchments/:id/exposure` |
| Historical labels | **Processed.** Groundsource (MD5 verified, 2,646,302 rows) intersected with the ten units; 4,298 raw reports → 1,456 deduplicated events; source UUIDs kept; negatives never inferred | `datasets/labels/groundsource_events.json`, `scripts/groundsource.py` |
| Historical features | **Processed.** NASA POWER daily precipitation (bias-corrected MERRA-2) and surface/root-zone soil wetness, 2005–2025, all ten catchments | `datasets/history/*.json`, `scripts/ingest-power.mjs` (ERA5-Land alternative kept in `scripts/ingest-history.mjs`) |
| Baseline model + ablation | **Experimental.** Weather-only vs weather+soil logistic baselines, held-out catchments and future period, PU-aware metrics, bootstrap intervals | `datasets/model/metrics.json`, `docs/MODEL_CARD.md` |
| Flood probability | **Null.** No calibration is possible with positive-unlabeled labels | `/api/v1/model-status` |
| WeatherNext 3 | **Not configured.** Access path declared in config; no query executed; never substituted by WN2 | `lib/providers/weathernext.mjs` |
| Notifications | **Implemented, sends disabled.** Consent, verification, templates (en/hi v1.0.0), authority approval, idempotent delivery queue, cancel/supersede, unsubscribe, audit | `lib/notifications.mjs` |
| Refuge marker | **Removed.** Replaced by `/shelters` reporting no authoritative dataset | `public/src/globe.js`, `lib/api/v1.mjs` |
| Persistence | SQLite via `node:sqlite` (`data/aegis.sqlite`); PostGIS schema and loader provided, not live | `lib/store/db.mjs`, `lib/store/postgis.sql`, `scripts/export-postgis.mjs` |

## Architecture

```
server.mjs → lib/app.mjs
  lib/config.mjs           typed env validation, secret marking
  lib/log.mjs              JSON logs, redaction (tokens, phones, payloads)
  lib/http/router.mjs      routes, request ids, rate limit, CSP/CORS, bounded bodies
  lib/http/fetch.mjs       allow-listed https upstreams, timeout, retry/backoff, size bound
  lib/store/db.mjs         SQLite: cache, forecast_runs, scenarios, subscriptions, advisories, deliveries, idempotency, audit_log, model_releases
  lib/catchments.mjs       registry from datasets/catchments.geojson + rivers.geojson
  lib/providers/*.mjs      openmeteo (runs), glofas, smap, terrain, exposure, weathernext
  lib/forecast.mjs         CatchmentForecast assembly (provenance, flags, limitations)
  lib/model/status.mjs     model status from datasets/model/metrics.json
  lib/notifications.mjs    subscriptions, advisories, delivery queue
  lib/api/v1.mjs           the /api/v1 contracts
scripts/                   ingest-catchments, ingest-power, ingest-history, groundsource.py, train-baseline, archive-forecasts, export-postgis, ingest-smap.py
datasets/                  versioned derived data served by the API (small); data/ holds raw downloads (ignored)
```

Contracts are documented in `docs/API.md`. The frontend seams are unchanged: `public/src/model.js` keeps the demonstration inputs and index; geometry now comes from `/api/v1/catchments` through `public/src/catalog.js`; `public/src/globe.js` draws the authoritative polygons (with holes) and HydroRIVERS reaches clamped to terrain; `public/src/app.js` displays edition, provenance, WorldPop exposure, model status, source status, the catchment forecast panel and shelter status.

## Ingestion and scheduling

- `node scripts/ingest-catchments.mjs --hydro <dir>`: parses the HydroBASINS/HydroRIVERS shapefiles (no GIS dependency; `scripts/shapefile.mjs`), selects the units containing the seed points, links upstream/downstream units, extracts reaches, writes provenance (SHA-1, size, CRS WKT, licence).
- `node scripts/archive-forecasts.mjs`: archives the current run of each model for each catchment; suitable for cron every 3 hours. Runs already archived for the provider's current initialisation time are not re-fetched. Native steps are stored before any aggregation.
- `node scripts/ingest-power.mjs`: NASA POWER daily features for training (no credentials, seconds per catchment). `scripts/ingest-history.mjs` is the ERA5-Land alternative, limited by Open-Meteo request weights.
- `python3 scripts/groundsource.py`: checksum, schema inspection, spatial intersection (DuckDB spatial), tiering, deduplication.
- `node scripts/train-baseline.mjs`: models, ablation, metrics, model card.
- `python3 scripts/ingest-smap.py`: SMAP L4 retrieval once `EARTHDATA_TOKEN` exists (unexecuted).

PostGIS: apply `lib/store/postgis.sql`, then `node scripts/export-postgis.mjs | psql "$DATABASE_URL"`. The API layer reads from the GeoJSON registry today; a PostGIS-backed `loadCatchments` is the intended swap point.

## Failure, staleness and unknown states

Provider outages are surfaced per model (`status:'unavailable'`), archived runs are served with `stale:true` and a limitation line, legacy weather serves `servedFrom:'stale-cache'`, and only a total outage yields 502. Missing values are `null` at every stage (grid cell, step, day). Places outside the ten units get weather only; flood risk is unknown. `floodProbability` is null. Nothing in any payload is an emergency warning.

## Security

Secrets live in `.env` or a secret manager and are marked in `lib/config.mjs`; health output reports presence only. Logs redact tokens, phone numbers and raw payloads. Upstream hosts are fixed. Query strings, path parameters, bodies and coordinates are validated. Static serving refuses dotfiles and path traversal. The map stack (MapLibre GL JS 6.9.0, self-hosted; OpenFreeMap, Esri imagery, AWS terrain tiles) needs no key, so no renderer token is exposed to the browser. The advisory approval key and admin key are bearer secrets compared in constant time. Audit records cover scenario creation, subscriptions, advisory create/approve/cancel and scheduled ingestion, without sensitive payloads.

## Remaining work before operational use

1. Earthdata credentials → run and validate `scripts/ingest-smap.py`; then redo the ablation with SMAP layers.
2. Approved WeatherNext 3 access → implement `lib/providers/weathernext3.mjs` against the approved bucket/table; label it only after an archived real run exists.
3. Ingest GHS-BUILT-S, building and WorldCover rasters (edition-tagged); replace nulls.
4. Replace reanalysis features with archived forecast runs to measure real lead time and forecast error; add ensemble disagreement.
5. Obtain ground-truth negatives (gauge or authority records) to make calibration and precision measurable; until then probability stays null.
6. Authoritative shelter dataset with the listed checks; keep `/shelters` empty until then.
7. Provider adapter, provider template approval (DLT for Indian SMS, WhatsApp templates), operator decision and legal review before `NOTIFICATION_SENDS_ENABLED=true`.
8. Deploy behind authentication, TLS, PostGIS, backups and monitoring; set `ALLOWED_ORIGINS` and `TRUST_PROXY` as appropriate.
