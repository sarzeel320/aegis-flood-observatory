# Delivery verification

Verified on 11 September 2026 on the original machine (macOS, Node 24.19.0 via the codex runtime, Python 3.9.6 with DuckDB 1.4.5) against live providers. Earlier frontend verification (11 September, before the backend) is retained at the end.

## Automated tests

`npm test`: 31 tests, 31 pass (`tests/foundation.test.mjs`, `tests/catchments.test.mjs`, `tests/providers.test.mjs`, `tests/api.test.mjs`, `tests/forecasts.test.mjs`, `tests/model.test.mjs`). Coverage by requirement:

- Configuration validation, secret presence-only reporting, log redaction (tokens, phone numbers, payloads; ISO timestamps preserved).
- Outbound fetch: https only, host allow-list, timeout, retry with backoff (3 attempts on 503), declared and streamed size bounds.
- Rate limiter refill; persistent cache TTL and explicit stale reads; delivery-queue idempotency.
- Catchments: ten HydroBASINS units with SHA-1 provenance, longitude/latitude order, closed rings, seed point containment, computed area within 2% of `SUB_AREA` (actual agreement <0.1%), river reaches and outlet reach, sample grid inside polygon.
- Provider adapters (mocked upstreams): grid-cell deduplication, missing cells excluded rather than zeroed, soil layer metadata, ensemble P10/P90/min/max, GloFAS alignment with null days preserved.
- Schema/contract: `/api/v1/catchments`, `/:id`, `/:id/rivers`, `/:id/runs`, `/:id/forecast`, `/:id/exposure`, `/:id/shelters`, `POST /scenarios`, `/model-status`, `/model-status/metrics`, `/sources`, health, ready, config, legacy routes.
- Provenance: every provenance entry carries source, dataset version, quality and licence; issue/valid times and native resolution on runs.
- Missing data: unavailable model listed with error, archived run served as `stale`, stale weather cache labeled, empty series reported as a failure state, HTTP 502 only when everything is down.
- Notifications: consent and E.164 validation, verification code (hash only), authority approval gating (401 without key, 503 when no key configured), held deliveries while sends are disabled, idempotent queue on re-approval attempts, supersede, cancel with delivery cancellation, unsubscribe, audit log without phone numbers.
- Security: CSP and frame headers on pages, dotfile and traversal refusal, 405/404/413/415 behaviour, request ids.

`npm run check`: all entry points and frontend modules pass `node --check`.

## Live verification (real providers)

| Check | Result |
|---|---|
| HydroBASINS level-8 ingestion | 28,907 Asia units scanned; the ten seed points resolved to ten distinct units; Kedarnath unit 4080756600, 1662.5 km² (computed 1662.5) |
| HydroRIVERS ingestion | 1,428,959 reaches scanned; 2,140 inside the ten units; outlet reach per unit chosen by upland area |
| `/api/v1/catchments/kedarnath/forecast` | ECMWF IFS run 2026-09-10T18:00Z, 24 native 3-hour steps, four soil layers (m³/m³), AIFS run 2026-09-10T18:00Z, WeatherNext 2 ensemble run 2026-09-10T12:00Z with 63 members, GloFAS daily discharge at outlet; first call 1.1 s from providers, second call 8 ms from archive |
| Archive by initialisation time | `scripts/archive-forecasts.mjs` archived 30 runs (10 catchments × 3 models), audit row `ingest.forecasts` written |
| `/api/v1/catchments/kedarnath/exposure` | WorldPop 2020 total 180,295 people (108 /km²) via POST statistics task; terrain min/mean/max 1237/2751/5278 m; built-up, buildings, land cover reported `not-ingested` with null values |
| `/api/v1/model-status` | Freshness for IFS/AIFS/WN2 (initialisation and availability times), SMAP latest granule 2026-09-08T21:00Z via CMR, credentials not configured, WeatherNext 3 not configured |
| Scenarios | Created under `research-scenario`; idempotent replay returned the same id with `Idempotent-Replayed: true`; different body with same key → 422; out-of-range saturation → 400 |
| Subscriptions/advisories | Subscription created pending, verified with the non-production code, unsubscribed; advisory drafted with English and Hindi previews; approval refused with 503 while `ADVISORY_AUTHORITY_KEY` is empty |
| Rate limiting | 130 rapid health requests → 110 × 200, 20 × 429 with `Retry-After` |
| Static security | `/` 200 with CSP; `/.env` 403; `/docs/RESEARCH.md` and `/datasets/catchments.geojson` 200 |
| Groundsource | Full download completed after resumed transfers (667,122,400 bytes); MD5 `cd1b5de6508f7aad8e1d1d0dd4cecea6` matches the Zenodo record; schema inspected (uuid, area_km2, WKB geometry, start_date, end_date); 448,378 events intersect the India bounding box; per-catchment raw reports → deduplicated events: Srinagar 1559→310, Manali 663→195, Kedarnath 398→156, Wayanad 370→125, Darjeeling 347→180, Shillong 289→169, Ooty 278→128, Gangtok 230→115, Mahabaleshwar 143→60, Tawang 21→18 |
| ERA5-Land history | Hourly precipitation and 0–7/7–28 cm soil water via the Open-Meteo archive API; the daily `precipitation_sum` variable returned null for `era5_land`, so hourly values are summed per day (any missing hour → null day). The provider's hourly request weight limit was hit twice; the script now waits for the next hour and resumes |
| PostGIS export | `scripts/export-postgis.mjs` produced 2,152 SQL statements (1.2 MB); not applied (no PostGIS on this machine) |
| Browser | MapLibre GL JS 6.9.0 (self-hosted) initialised under a strict CSP with no `unsafe-eval`; 232 tiles loaded from OpenFreeMap, Esri and AWS with no failed requests; 3D mode drapes the HydroBASINS polygon on terrain with hillshade, 2D mode shows the OpenFreeMap vector map; attribution lists all three sources; region panel shows edition, unit id, area, reach count and WorldPop population; forecast panel shows three cards, ensemble P10–P90 and six provenance lines; shelter check returns the required-checks list; scenario save returns the research-namespace id; alert dialog shows the backend notification status |

## Model and ablation

Historical features: the Open-Meteo ERA5-Land route was abandoned after two hourly-quota stalls (its daily precipitation variable also returned null). `scripts/ingest-power.mjs` pulled NASA POWER daily data (MERRA-2 bias-corrected precipitation, surface and root-zone soil wetness) for all ten catchment centroids, 2005–2025, in 24 seconds with zero missing days. The retired ERA5-Land script is kept for a later cross-check.

`scripts/train-baseline.mjs` ran in 42 s: 76,400 catchment-days; train 35,327 rows (368 positives, 2005–2018, seven catchments); test-future 12,782 rows (986 positives, 2021–2025); held-out catchments Manali, Tawang, Ooty 22,920 rows (663 positives). Results (full tables in `docs/MODEL_CARD.md`):

- Weather-only, 1-day lead: PU-AUC 0.807 (future period), 0.786 (held-out catchments); recall of event days at a 5% alert rate 0.19 and 0.28; alerts on unlabeled days about 1.0–1.3 per basin-month at that rate.
- Weather+soil, 1-day lead: PU-AUC 0.784 and 0.775; recall@5% 0.18 and 0.24.
- Ablation verdict (bootstrap over test years): soil wetness features do **not** improve the baseline; PU-AUC drops by 0.024 (90% interval −0.040 to −0.013) on the future period and recall@5% drops on held-out catchments. The demo slider's response is therefore not evidence of a soil benefit. This is a result for MERRA-2 0.5° model wetness only; SMAP L4 and ERA5-Land remain untested.
- Calibration: not attempted (positive-unlabeled labels). `mode` is now `experimental`; `floodProbability` stays null; `floodProbabilityAvailable` is false.

The model-status route and the frontend badge switched from "demonstration" to "experimental (research only)" after the run, and the contract tests were updated to accept either non-validated mode.

## Limits of verification

- No Earthdata credentials: `scripts/ingest-smap.py` is unexecuted; SMAP series are reported `missing`.
- No WeatherNext 3 access: nothing labeled WeatherNext 3 exists in any payload.
- No PostGIS instance: the schema and loader are syntactically produced but not applied.
- GHSL built-up, building and WorldCover rasters are not ingested; their fields are null by design.
- No messaging provider; no message was sent; `NOTIFICATION_SENDS_ENABLED=false`.
- Labels are positive-unlabeled; precision and calibration are bounds, not measurements.
- Map rendering was verified by screenshot after the MapLibre migration (terrain, draped catchment, labels, attribution visible).
- Offline and WebGL-failure branches remain implemented but were not exercised by disabling the device or network.

## Earlier frontend verification (retained)

- JavaScript syntax checks; five model checks; HTTP 200 for app, research page and health; 400 for out-of-range coordinates; 404 for unknown API routes.
- Open-Meteo weather, Cesium World Terrain with the local token, desktop 1440×1000 and mobile 390×844 layouts, search, filters, 2D/3D, timeline, presets, apply, virtual sensor, live-rainfall copy, alert dialog in English and Hindi, empty browser error log.
- ECMWF AIFS/IFS and WeatherNext 2 comparison displayed; Groundsource record inspected.
