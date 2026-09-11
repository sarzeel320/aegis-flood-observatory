# Backend completion prompt

> **Status (11 September 2026): this brief has been executed.** The map layer was later migrated from CesiumJS to self-hosted MapLibre GL JS 6.9.0 with key-free basemaps, so the Cesium token bullet below is obsolete. The resulting state is recorded in `docs/BACKEND_HANDOFF.md` (status table), `docs/API.md` (contracts), `docs/MODEL_CARD.md` (what is and is not validated) and `docs/QA.md` (evidence). Items that remain blocked on credentials or external approval are listed under "Remaining work before operational use" in the handoff. The original brief is kept below unchanged for traceability.

Paste the following prompt into the backend coding agent after giving it the complete `AEGIS-frontend-source.zip` archive.

```text
You are completing the backend for AEGIS — Mountain Flood Observatory, an existing frontend in a plain Node.js project. Read these files first:

- README.md
- docs/BACKEND_HANDOFF.md
- docs/RESEARCH.md
- public/src/model.js
- public/src/app.js
- public/src/globe.js
- server.mjs

Do not redesign the frontend. Preserve its visual language and interaction contracts. Keep every result explicitly labeled as demonstration, experimental, or validated. Do not call any score a probability until it has been trained, calibrated, and evaluated.

Goal: replace the synthetic regional data with traceable, versioned, validated catchment intelligence for Indian hill regions while keeping the existing demo mode available.

Phase 1 — production foundation

1. Move the local server to a typed FastAPI or equivalent service only if that reduces implementation risk. Keep HTTP JSON contracts compatible with the frontend.
2. Add configuration validation, structured logs, request IDs, rate limiting, persistent cache, outbound timeouts, retry/backoff, CORS/CSP rules, and health/readiness checks. Never log credentials, tokens, phone numbers, or raw private sensor payloads.
3. Implement the contract below. Return ISO UTC timestamps, GeoJSON coordinates in longitude/latitude order, source dataset version, issue time, valid time, native resolution, quality flags, and limitations in every forecast payload.

GET /api/v1/catchments

Return authoritative basin/catchment IDs, names, states, geometries, river links, edition, spatial reference, and provenance. Replace the ten synthetic polygons. Do not infer catchments from place-name circles.

GET /api/v1/catchments/:id/forecast

Return hourly or native model steps for precipitation, soil moisture by depth, discharge, and any validated flood output. Preserve missing values as null. Return model version, ensemble members or summary statistics, issue/valid times, and a model-status object.

GET /api/v1/catchments/:id/exposure

Return dated population, built-up area, building exposure, land cover and uncertainty from versioned geospatial products. Exposure is an impact input, not a direct runoff probability.

POST /api/v1/scenarios

Accept a clearly named research scenario with catchment ID, optional assumed soil saturation, rainfall override, and model inputs. Store or return it under an explicit scenario namespace. Make it impossible to confuse with an operational advisory.

GET /api/v1/model-status

Return model name, version, training/evaluation period, supported region, data freshness, calibration status, known limitations and whether the output is demonstration, experimental, or validated.

Phase 2 — data ingestion

1. Ingest authoritative catchment boundaries and river topology into PostGIS. Keep geometry edition and coordinate reference system.
2. Fetch and archive forecast runs from ECMWF IFS/AIFS or a permitted provider before resampling. Store the source run, issue time, valid times, native resolution, and license.
3. Keep Google WeatherNext 3 behind its approved access path. It is an operational service and is not open source. Do not substitute WeatherNext 2 and label it WeatherNext 3. The current frontend comparison uses WeatherNext 2 as a separate context model.
4. Add Open-Meteo GloFAS discharge only as riverine context. GloFAS discharge is not an urban cloudburst footprint and must not be rendered as one.
5. Ingest NASA SMAP L4 Version 8 surface and root-zone moisture only after Earthdata credentials are configured. Keep depth, units, spatial resolution, timestamps and quality flags. Do not convert m³/m³ into saturation percentage without porosity/residual-water assumptions.
6. Add terrain, vegetation, impervious/built-up and settlement layers with edition and reference year. Prefer the current Copernicus DEM 2024 edition where appropriate; the older GLO-30 catalog entry is deprecated. Retain GHSL/WorldCover provenance and do not call 2021 land cover live.
7. Groundsource is a 2.6 million-record historical news-derived flood dataset. Download and process it as historical labels only. The record is about 667 MB in its current parquet file and is licensed CC BY 4.0. Inspect the schema and spatial encoding before filtering. Do not treat news absence as a negative label. Deduplicate events and preserve source identifiers.

Phase 3 — model and validation

1. Build a baseline weather-only model and a weather-plus-soil model. Keep the same catchment/time splits for both.
2. Use held-out basins and future periods. Avoid spatial and temporal leakage. Test the distribution shift between news-derived urban events and mountain flash floods.
3. Evaluate calibration, precision/recall at event prevalence, false alarms per basin-month, lead time, missed severe events, missing-data behavior, ensemble disagreement, and uncertainty intervals.
4. Run an ablation study to prove whether soil moisture improves useful lead time and calibration. Do not claim it helps because the demo slider changes the score.
5. Publish a model card and machine-readable metrics. Keep flood probability null until calibration is complete.

Phase 4 — map and messaging

1. Replace synthetic red footprints with validated raster probabilities or inundation polygons. Terrain-clamp them to the surface. Keep map styling separate from numeric computation.
2. Remove or replace the green candidate refuge marker with an authoritative shelter dataset. Verify elevation, channel proximity, road/bridge conditions, capacity, landslide exposure, accessibility, and authority approval. A nearest point is not a safe-area recommendation.
3. Implement subscriptions, verified consent, language, area, template version, advisory approval, idempotency, delivery queue, provider status, cancellation and unsubscribe. The current UI only previews/copies English or Hindi text and never sends messages.
4. Add official-authority attribution, issue time, affected area, recommended action, expiry, update/cancel semantics, and a direct link to official warnings.

Security and delivery constraints

- Keep provider tokens in a secret manager or environment, never in frontend source, ZIP archives, logs or URLs.
- The Cesium token is a client-visible read-only renderer token; use origin restrictions and never an admin/write token.
- Validate lat/lon and all query strings. Fix upstream hosts. Set timeouts and bound response sizes.
- Add audit logs for model releases and advisories without sensitive payloads.
- Preserve the frontend's failure, stale-data and unknown-risk states.
- Run the existing tests plus integration tests for each provider adapter, schema contract tests, provenance tests, missing-data tests, and notification idempotency tests.
- Before calling the project operational, update README.md, docs/BACKEND_HANDOFF.md, docs/RESEARCH.md and docs/QA.md with exact evidence and limits. Do not claim national coverage without national validated data.

Definition of done:

- All five `/api/v1` contracts are implemented and documented.
- At least one authoritative catchment geometry edition and one versioned weather source are live.
- Soil data has units/depth/quality metadata and the soil ablation has held-out metrics.
- The model card states what is and is not validated.
- The frontend displays provenance, missingness, model status and uncertainty.
- No synthetic footprint, exposure, refuge, or score is presented as an emergency warning.
- Notification sends remain disabled until consent, authority and provider checks are complete.
- Tests, failure paths, the final ZIP, and the user-facing README are updated.
```
