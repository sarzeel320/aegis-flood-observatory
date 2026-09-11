# AEGIS API reference (v1)

Base URL: `http://127.0.0.1:4173`. All timestamps are ISO 8601 UTC. All coordinates are GeoJSON `[longitude, latitude]` in EPSG:4326. Every response carries an `X-Request-Id` header. Errors are `{ "error": string, "details"?: object, "requestId": string }`.

Modes: every forecast/model payload carries `mode` = `demonstration` | `experimental` | `validated`. The current release is `experimental` (a trained but uncalibrated research baseline exists) and `floodProbability` is `null` everywhere.

## Service

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness, version, mode, notification state |
| `GET /api/ready` | Readiness: store check, catchment count, archived-run count (503 when the store fails) |
| `GET /api/config` | Map stack description (MapLibre GL JS version, self-hosted path, basemap/imagery/terrain sources; no keys) |
| `GET /api/v1/sources` | Provider catalogue and status for every data source |

## Catchments

`GET /api/v1/catchments` → GeoJSON `FeatureCollection` of the ten HydroBASINS v1.c level-8 units. Top-level `edition`, `spatialReference`, `coordinateOrder`, `provenance` (source file SHA-1, size, retrieval time, CRS WKT, licence, citation). Feature properties: `id`, `name`, `state`, `group`, `riverName`, `hybasId`, `pfafId`, `level`, `nextDown`, `mainBasin`, `upstreamUnits`, `downstreamUnit`, `subAreaKm2`, `upstreamAreaKm2`, `computedAreaKm2`, `endorheic`, `coastal`, `bbox`, `centroid`, `seedPoint`, `outletPoint`, `outletReach`, `reachCount`, `edition`.

`GET /api/v1/catchments/:id` → one feature with provenance.  
`GET /api/v1/catchments/:id/rivers` → HydroRIVERS v1.0 reaches inside the unit (`hyrivId`, `nextDown`, `mainRiver`, `lengthKm`, `uplandKm2`, `meanDischargeM3S` (long-term modelled mean), `strahlerOrder`, …).  
`GET /api/v1/catchments/:id/runs` → archived forecast runs (provider, model, issue time, retrieval time, valid window, native resolution, licence).

## Forecast

`GET /api/v1/catchments/:id/forecast` → `CatchmentForecast`:

| Field | Meaning |
|---|---|
| `mode`, `outputLabel`, `modelStatus` | Demonstration/experimental/validated and the model-status summary |
| `geometry`, `geometryEdition`, `spatialReference`, `coordinateOrder` | Catchment polygon and its edition |
| `issuedAt`, `validFrom`, `validTo`, `stepSeconds`, `nativeResolutionM` | Primary run (ECMWF IFS 0.25°, native 3-hour steps) |
| `times[]` | Native model steps (UTC) |
| `precipitationMm[]`, `precipitationMmPerHour[]`, `precipitationCellSpread` | Catchment mean per step; missing steps are `null`; per-step min/max across grid cells and cell counts |
| `soilVolumetricM3M3[]` | Layers `{key, topCm, bottomCm, unit, source, values[]}` from the weather model's land surface (0–7, 7–28, 28–100, 100–255 cm) |
| `soilSaturationFraction[]` | Always `null` (no porosity/residual-water parameters); see `soilSaturationNote` |
| `smapL4` | SMAP L4 v8 series when ingested, otherwise `{status:'missing', reason}` |
| `floodProbability[]`, `probabilityInterval[]` | `null` until a calibrated validated release exists |
| `dischargeM3S[]`, `dischargeAlignment`, `discharge` | GloFAS daily discharge repeated per step of the same UTC date; raw daily series with P25/P75 under `discharge` |
| `qualityFlags[][]` | Per step: `precipitation-missing`, `partial-grid-coverage`, `valid-time-in-past`, `soil-missing` |
| `models[]` | Each archived run: ECMWF IFS, ECMWF AIFS Single, Google WeatherNext 2 ensemble (`ensemble.p10/p90/min/max`, `memberCount`), `servedFrom` (`provider`/`archive`), `stale` |
| `provenance[]` | One entry per source: `source`, `datasetVersion`, `retrievedAt`, `issuedAt`, `validAt`, `nativeResolutionM`, `quality`, `licenseUrl`, `role` |
| `limitations[]` | Always present |

Failure semantics: provider failures never produce invented numbers. A model that is down is listed as `status:'unavailable'` with its error; if a previous run is archived it is served with `stale:true`. Only when every provider is down is HTTP 502 returned. An empty `times` array is a failure state, not a calm forecast.

## Exposure

`GET /api/v1/catchments/:id/exposure` → `population` (WorldPop 2020 unconstrained 100 m, total and density, `uncertainty:null` because the product publishes none), `builtUp`/`buildings`/`landCover` (declared products GHS-BUILT-S R2023A, WorldCover v200 2021; `status:'not-ingested'`, values `null`), `terrain` (Copernicus DEM GLO-90 via Open-Meteo: min/mean/max elevation, relief, coarse slope with its caveat). Exposure is an impact input, not a runoff driver.

`GET /api/v1/catchments/:id/shelters` → `status:'no-authoritative-dataset'`, empty list, the checks required before any shelter can be recommended.

## Scenarios (research namespace)

`POST /api/v1/scenarios` with `{ name, catchmentId, assumedSoilSaturationFraction? (0–1), rainfallOverrideMmPerHour? (0–500), modelInputs?: { slopeDeg?, builtFraction?, treeFraction? }, description? }`. Optional `Idempotency-Key` header (8–128 chars); a replay returns the stored response with `Idempotent-Replayed: true`, a different body with the same key returns 422. Response: `scenario` with `namespace:'research-scenario'`, `mode:'demonstration'`, `notAnAdvisory:true`, the demonstration index (with and without the soil term, `isProbability:false`) and `floodProbability:null`.

`GET /api/v1/scenarios?catchmentId=` and `GET /api/v1/scenarios/:id`.

## Model status

`GET /api/v1/model-status` → `mode`, `modelName`, `modelVersion`, `trainingPeriod`, `evaluationPeriod`, `heldOutCatchments`, `supportedRegion`, `labels`, `calibration`, `ablation` (verdict and bootstrap intervals), `metrics` (per configuration and test set), `dataFreshness` (latest ECMWF/WeatherNext 2 run initialisation and availability times, SMAP latest granule and credential status, archived-run count), `knownLimitations`, `demonstrationIndex` (weights of the classroom index), `weatherNext` (WN3 access status, WN2 context status), `modelCard` (`/docs/MODEL_CARD.md`), `releases`.  
`GET /api/v1/model-status/metrics` → the raw `datasets/model/metrics.json`.

## Notifications (sends disabled)

| Route | Behaviour |
|---|---|
| `POST /api/v1/subscriptions` | `{channel: sms\|whatsapp, address: E.164, language: en\|hi, catchmentId, consent: {accepted:true, textVersion}}`. Creates `pending-verification`; verification delivery is `not sent` while sends are disabled. Non-production responses include `devVerificationCode` for testing. Supports `Idempotency-Key`. |
| `POST /api/v1/subscriptions/:id/verify` | `{code}` → `active`. Codes expire after 15 minutes; hashes only are stored. |
| `DELETE /api/v1/subscriptions/:token` or `POST /api/v1/subscriptions/unsubscribe {token}` | Unsubscribe. |
| `POST /api/v1/advisories` | Draft with `catchmentId`, `authority`, `issuedAt`, `expiresAt`, `affectedArea`, `recommendedAction`, `officialLink` (https), optional `supersedes`, `notes`. Renders English and Hindi previews from template `flood-advisory` v1.0.0. |
| `POST /api/v1/advisories/:id/approve` | Requires `Authorization: Bearer <ADVISORY_AUTHORITY_KEY>` (503 when no key is configured). Marks the previous advisory `superseded`, enqueues one delivery per active subscription with idempotency key `advisory:subscription:templateVersion`; deliveries are `held` while sends are disabled. |
| `POST /api/v1/advisories/:id/cancel` | Authority key; cancels held/queued deliveries and returns cancellation message previews. |
| `GET /api/v1/advisories`, `/:id`, `/:id/deliveries`, `GET /api/v1/notifications/status` | Inspection. |
| `GET /api/v1/audit` | `Authorization: Bearer <ADMIN_API_KEY>`; audit entries never contain addresses or payloads. |

## Legacy point routes (kept for the UI)

`GET /api/places?q=`, `GET /api/weather?lat=&lon=`, `GET /api/compare?lat=&lon=`. Coordinates must lie in the supported bounding box (lat 6–38, lon 68–98). Weather responses served from an expired cache during a provider outage carry `servedFrom:'stale-cache'`.

## Security headers and limits

Per-IP token bucket (`RATE_LIMIT_PER_MINUTE`, default 120) on `/api/*` → 429 with `Retry-After`. JSON bodies limited to `REQUEST_BODY_MAX_BYTES` (64 KB) → 413; non-JSON → 415. Outbound calls go only to allow-listed hosts over https with `OUTBOUND_TIMEOUT_MS`, exponential backoff and an `OUTBOUND_MAX_BYTES` response bound. Static pages get a strict Content-Security-Policy: `script-src 'self'` only (MapLibre GL JS is self-hosted and needs no eval), `worker-src 'self' blob:`, and `img-src`/`connect-src` limited to the tile hosts (tiles.openfreemap.org, services/server.arcgisonline.com, s3.amazonaws.com) plus Google Fonts. CORS is off unless `ALLOWED_ORIGINS` lists the origin.
