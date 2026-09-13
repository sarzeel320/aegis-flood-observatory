# AEGIS — Mountain Flood Observatory

An Indian mountain flood research prototype: a MapLibre GL JS frontend over a dependency-free Node.js backend that serves authoritative catchment geometry, archived weather runs, soil layers, riverine discharge context, dated exposure, research scenarios, model status and a consent-gated (disabled) notification workflow. Open `http://127.0.0.1:4173` after starting the server.

**This is a research prototype. It does not issue emergency warnings. Flood probability is null until a calibrated, validated model exists.**

## Run

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`). No package installation or build step.

```sh
npm start
```

Or `node server.mjs`. The server listens on `127.0.0.1:4173` and creates `data/aegis.sqlite`. MapLibre GL JS 6.9.0 is self-hosted under `public/vendor/`. Internet access is required for the basemap tiles (OpenFreeMap vector tiles from OpenStreetMap, Esri World Imagery, AWS Terrain Tiles) and the weather, discharge, elevation, population and NASA discovery providers. No map API key is needed. Copy `.env.example` to `.env` to configure it.

On the original machine, if Node is not on PATH:

```sh
/Users/sarzeelkhan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

## What is live

| Signal | Source | Version / edition | Route |
|---|---|---|---|
| Catchment boundaries | HydroSHEDS HydroBASINS | v1.c, level 8, Asia (2014) | `/api/v1/catchments` |
| River topology | HydroSHEDS HydroRIVERS | v1.0 (2019) | `/api/v1/catchments/:id/rivers` |
| Precipitation, model soil layers | ECMWF IFS 0.25°, ECMWF AIFS Single, via Open-Meteo | run initialisation time archived per run | `/api/v1/catchments/:id/forecast` |
| Ensemble context | Google WeatherNext 2 ensemble via Open-Meteo (not WeatherNext 3) | 63 members, 6-hour steps | same |
| Riverine discharge | GloFAS v4 via Open-Meteo Flood API | daily, ~5 km | same (`discharge`) |
| Population | WorldPop unconstrained 100 m | reference year 2020 | `/api/v1/catchments/:id/exposure` |
| Terrain statistics | Copernicus DEM GLO-90 via Open-Meteo | 2021 release | same (`terrain`) |
| SMAP L4 soil moisture | NASA SPL4SMGP | v008 (discovery only; retrieval needs Earthdata token) | `/api/v1/sources` |
| Historical labels | Google Groundsource (Zenodo) | 2026 release, MD5 verified | `datasets/labels/` |
| Baseline model | AEGIS weather-only vs weather+soil logistic baselines | 0.1.0-experimental | `/api/v1/model-status`, `docs/MODEL_CARD.md` |

Not live: built-up/building/land-cover rasters (declared with editions, values null), WeatherNext 3 (allow-listed), SMAP retrieval (credentials), any shelter dataset, any message sending.

## Source guide

| Path | Purpose |
|---|---|
| `public/index.html`, `public/styles.css` | Interface (unchanged visual system) |
| `public/src/app.js`, `globe.js`, `model.js`, `catalog.js` | UI state; MapLibre globe and 2D/3D map with real boundaries, HydroRIVERS reaches and terrain; demonstration index; backend client |
| `server.mjs`, `lib/app.mjs` | Entry point and composition root |
| `lib/config.mjs`, `lib/log.mjs`, `lib/http/*` | Config validation, redacting logs, router (request ids, rate limit, CSP/CORS), bounded outbound fetch |
| `lib/store/db.mjs`, `lib/store/postgis.sql` | SQLite store; PostGIS schema |
| `lib/providers/*` | Open-Meteo runs, GloFAS, SMAP, terrain, exposure, WeatherNext status |
| `lib/forecast.mjs`, `lib/model/status.mjs`, `lib/notifications.mjs`, `lib/api/v1.mjs` | Forecast assembly, model status, notifications, contracts |
| `scripts/*` | Ingestion (catchments, forecasts, history, Groundsource, SMAP), training, PostGIS export |
| `datasets/*` | Versioned derived data with provenance |
| `docs/API.md`, `docs/BACKEND_HANDOFF.md`, `docs/MODEL_CARD.md`, `docs/RESEARCH.md`, `docs/QA.md` | Contracts, status, model card, sources, verification |

## Reproduce the data pipeline

```sh
npm run ingest:catchments -- --hydro data/hydrosheds   # needs hybas_as_lev08_v1c.* and HydroRIVERS_v10_as_shp/
npm run ingest:forecasts                                 # archive current runs (cron every 3 h)
npm run ingest:history                                   # NASA POWER daily features (ERA5-Land alternative: node scripts/ingest-history.mjs)
python3 -m pip install --user duckdb && npm run labels:groundsource   # needs data/groundsource_2026.parquet
npm run train                                            # metrics.json, weights.json, MODEL_CARD.md
```

## Host it online

### Free Vercel deployment

Import this repository into Vercel on the Hobby plan. The root `server.mjs` is the Node server entrypoint; `vercel.json` includes the application assets and datasets. No database subscription or API key is required for the existing map and weather features.

Vercel uses `/tmp/aegis.sqlite`, which is temporary and private to each server instance. Saved scenarios, forecast archives, subscriptions and audit records can reset on restart or redeployment and are not shared across instances. Use this deployment for research demonstrations, not durable records or message delivery. Bundled research datasets remain available. A persistent database is required before relying on saved records in production.

### Other Node hosts

The server is a single Node process with no build step and no native dependencies. Any host that runs Node 22.13+ works.

- Set `HOST=0.0.0.0` and let the platform supply `PORT`. Set `NODE_ENV=production`, `TRUST_PROXY=true` behind a load balancer, and `ALLOWED_ORIGINS` only if another site must call the API.
- The SQLite store lives at `AEGIS_DB_PATH` (default `data/aegis.sqlite`). On hosts with an ephemeral disk the archive and queues reset on redeploy; mount a volume or point the path at persistent storage.
- Docker: `docker build -t aegis . && docker run -p 4173:4173 -e HOST=0.0.0.0 aegis`.
- Render / Railway / Fly: build command none, start command `npm start`, health check `/api/ready`.
- GitHub Actions (`.github/workflows/ci.yml`) runs the tests on every push.

## Credentials

`.env` is ignored and excluded from the ZIP. The maps need no key: MapLibre is self-hosted and OpenFreeMap, Esri World Imagery and AWS Terrain Tiles are open, key-free services (any old `CESIUM_ION_TOKEN` line is ignored and can be deleted). `EARTHDATA_TOKEN`, WeatherNext access settings, `ADVISORY_AUTHORITY_KEY` and `ADMIN_API_KEY` are server-side secrets; they never appear in logs, health output or the frontend.

## Data interpretation

The map colours catchments with a classroom sensitivity index (demonstration), drawn over authoritative HydroBASINS boundaries. The index is not a probability and never feeds any computation. Forecast rainfall is a 25 km-grid catchment mean at native model steps. Soil layers are weather-model soil states in m³/m³, not measurements, and are not converted to saturation. GloFAS discharge is riverine context, not a cloudburst footprint. Population is an impact input. The baseline model is experimental and uncalibrated because its labels are news-derived and positive-unlabeled; see the model card for exactly what is and is not validated.

## Verify

```sh
npm test
npm run check
```

`docs/QA.md` records the verification performed during delivery.
