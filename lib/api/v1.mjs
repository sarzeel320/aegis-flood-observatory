// Versioned API contracts. All timestamps are ISO 8601 UTC; all coordinates are [longitude, latitude] (EPSG:4326).
import { HttpError, hashBody } from '../http/router.mjs';
import { buildForecastPayload } from '../forecast.mjs';
import { riskIndex, clamp } from '../../public/src/model.js';
import { inSupportedBbox } from '../geo.mjs';
export const SCENARIO_NAMESPACE = 'research-scenario';
const settled = (label, promise) => promise.then(value => ({ status: 'available', label, value })).catch(error => ({ status: 'unavailable', label, error: error.message }));
export function registerV1(router, { catchments, providers, store, config, modelStatus, notifications, logger, version }) {
  const requireCatchment = id => { const c = catchments.get(id); if (!c) throw new HttpError(404, 'Unknown catchment id'); return c; };
  const requireAdmin = ctx => { const header = ctx.req.headers.authorization || ''; if (!config.ADMIN_API_KEY || header !== `Bearer ${config.ADMIN_API_KEY}`) throw new HttpError(config.ADMIN_API_KEY ? 401 : 503, config.ADMIN_API_KEY ? 'Admin key required' : 'ADMIN_API_KEY is not configured'); };
  const idempotent = async (ctx, route, produce) => {
    const key = ctx.req.headers['idempotency-key'];
    if (key === undefined) return produce();
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new HttpError(400, 'Idempotency-Key must be 8–128 characters of [A-Za-z0-9._:-]');
    const requestHash = hashBody(ctx.body);
    const hit = store.idempotency.get(key);
    if (hit) { if (hit.request_hash !== requestHash || hit.route !== route) throw new HttpError(422, 'Idempotency-Key was already used with a different request'); return { status: hit.status, body: hit.response, headers: { 'Idempotent-Replayed': 'true' } }; }
    const result = await produce();
    const status = result.status ?? 200, body = result.body ?? result;
    store.idempotency.set(key, route, requestHash, status, body);
    return { status, body };
  };

  router.get('/api/v1/catchments', () => ({ body: {
    kind: 'FeatureCollection', type: 'FeatureCollection', edition: catchments.edition, spatialReference: catchments.spatialReference, coordinateOrder: 'longitude,latitude', generatedAt: catchments.generatedAt,
    provenance: catchments.provenance, count: catchments.ids().length, coverage: 'Ten HydroBASINS level-8 units containing the AEGIS study sites in Indian hill regions. Not national coverage.',
    features: catchments.ids().map(id => catchments.feature(catchments.get(id)))
  } }));
  router.get('/api/v1/catchments/:id', ctx => ({ body: { ...catchments.feature(requireCatchment(ctx.params.id)), provenance: catchments.provenance.catchments } }));
  router.get('/api/v1/catchments/:id/rivers', ctx => ({ body: catchments.riversFor(requireCatchment(ctx.params.id).id) }));
  router.get('/api/v1/catchments/:id/runs', ctx => ({ body: { catchmentId: requireCatchment(ctx.params.id).id, runs: store.forecastRuns.list(ctx.params.id, 50).map(r => ({ id: r.id, provider: r.provider, model: r.model, issuedAt: r.issued_at, retrievedAt: r.retrieved_at, validFrom: r.valid_from, validTo: r.valid_to, nativeResolution: r.native_resolution, stepSeconds: r.step_seconds, license: r.license })) } }));

  router.get('/api/v1/catchments/:id/forecast', async ctx => {
    const catchment = requireCatchment(ctx.params.id);
    const modelIds = ['ecmwf_ifs025', 'ecmwf_aifs025_single', 'google_weathernext2_ensemble'];
    const [runs, discharge] = await Promise.all([
      Promise.all(modelIds.map(id => settled(id, providers.openMeteo.latestRun(catchment, providers.openMeteo.models[id])))),
      settled('glofas', providers.glofas.discharge(catchment))
    ]);
    const runResults = runs.map(r => (r.status === 'available' ? { status: 'available', run: r.value } : { status: 'unavailable', model: r.label, error: r.error }));
    if (runResults.every(r => r.status === 'unavailable') && discharge.status === 'unavailable') throw new HttpError(502, 'All forecast providers are unavailable', { models: runResults });
    const payload = buildForecastPayload({ catchment, runs: runResults, discharge: discharge.status === 'available' ? discharge.value : { status: 'unavailable', error: discharge.error }, smap: providers.smap.series(catchment), modelStatus: modelStatus() });
    return { body: payload, headers: { 'Cache-Control': 'private, max-age=60' } };
  });

  router.get('/api/v1/catchments/:id/exposure', async ctx => {
    const catchment = requireCatchment(ctx.params.id);
    const [population, terrain] = await Promise.all([settled('population', providers.exposure.population(catchment)), settled('terrain', providers.terrain.terrain(catchment))]);
    return { body: {
      catchmentId: catchment.id, catchmentName: catchment.name, generatedAt: new Date().toISOString(), areaKm2: catchment.computedAreaKm2, geometryEdition: catchment.edition,
      population: population.status === 'available' ? population.value : { status: 'unavailable', error: population.error, ...providers.exposure.products.population, totalPopulation: null },
      builtUp: { status: 'not-ingested', fractionOfArea: null, ...providers.exposure.products.builtUp },
      buildings: { status: 'not-ingested', count: null, ...providers.exposure.products.buildings },
      landCover: { status: 'not-ingested', treeCoverFraction: null, builtFraction: null, ...providers.exposure.products.landCover },
      terrain: terrain.status === 'available' ? terrain.value : { status: 'unavailable', error: terrain.error, product: providers.terrain.product },
      interpretation: 'Exposure is an impact input. Population is not a runoff driver and must not be converted into flood probability.',
      limitations: ['Population is a 2020 reference-year estimate on a 100 m grid intersected with the catchment polygon; night-time residence, not daytime presence.', 'Built-up, building and land-cover layers are declared with editions but not yet ingested; their values are null rather than estimated.', 'Uncertainty is reported as null where the product does not publish it.']
    }, headers: { 'Cache-Control': 'private, max-age=300' } };
  });

  router.get('/api/v1/catchments/:id/shelters', ctx => {
    const catchment = requireCatchment(ctx.params.id);
    return { body: { catchmentId: catchment.id, status: 'no-authoritative-dataset', shelters: [], count: 0, dataset: null, requiredChecks: ['authority approval and dataset provenance', 'elevation relative to channel and current forecast footprint', 'road and bridge condition', 'capacity', 'landslide exposure', 'accessibility'], note: 'No shelter or safe-area recommendation is available. A nearest point is not a safe area. The former demonstration marker has been removed.' } };
  });

  router.post('/api/v1/scenarios', ctx => idempotent(ctx, 'scenarios', () => {
    const b = ctx.body ?? {};
    const catchment = requireCatchment(String(b.catchmentId ?? ''));
    if (typeof b.name !== 'string' || b.name.trim().length < 3 || b.name.length > 120) throw new HttpError(400, 'name is required (3–120 characters)');
    const num = (v, field, min, max) => { if (v === undefined || v === null) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${field} must be a number between ${min} and ${max}`); return v; };
    const assumedSoilSaturationFraction = num(b.assumedSoilSaturationFraction, 'assumedSoilSaturationFraction', 0, 1);
    const rainfallOverrideMmPerHour = num(b.rainfallOverrideMmPerHour, 'rainfallOverrideMmPerHour', 0, 500);
    const inputs = b.modelInputs ?? {};
    const modelInputs = { slopeDeg: num(inputs.slopeDeg, 'modelInputs.slopeDeg', 0, 90), builtFraction: num(inputs.builtFraction, 'modelInputs.builtFraction', 0, 1), treeFraction: num(inputs.treeFraction, 'modelInputs.treeFraction', 0, 1) };
    const indexInputs = { rain: rainfallOverrideMmPerHour ?? 0, soil: (assumedSoilSaturationFraction ?? 0) * 100, slope: modelInputs.slopeDeg ?? 0, built: (modelInputs.builtFraction ?? 0) * 100, trees: (modelInputs.treeFraction ?? 0) * 100 };
    const payload = { mode: 'demonstration', notAnAdvisory: true, assumedSoilSaturationFraction, rainfallOverrideMmPerHour, modelInputs, units: { rainfallOverrideMmPerHour: 'mm/hour', assumedSoilSaturationFraction: 'fraction 0–1 (assumed, not measured)', slopeDeg: 'degrees', builtFraction: 'fraction 0–1', treeFraction: 'fraction 0–1' }, demonstrationIndex: { value: riskIndex(indexInputs), withoutSoilTerm: riskIndex({ ...indexInputs, soil: 0 }), type: 'uncalibrated sensitivity index (0–100)', isProbability: false }, floodProbability: null, description: typeof b.description === 'string' ? b.description.slice(0, 2000) : null };
    const scenario = store.scenarios.create({ namespace: SCENARIO_NAMESPACE, catchmentId: catchment.id, name: b.name.trim(), createdBy: ctx.ip, payload });
    store.audit.record({ actor: ctx.ip, action: 'scenario.create', subjectType: 'scenario', subjectId: scenario.id, requestId: ctx.requestId, details: { catchmentId: catchment.id } });
    return { status: 201, body: { scenario, disclaimer: 'Research scenario under the research-scenario namespace. It is not an operational advisory and must not be distributed as a warning.' } };
  }));
  router.get('/api/v1/scenarios', ctx => { const id = ctx.query.get('catchmentId'); if (id) requireCatchment(id); return { body: { namespace: SCENARIO_NAMESPACE, scenarios: store.scenarios.list(id) } }; });
  router.get('/api/v1/scenarios/:id', ctx => { const s = store.scenarios.get(ctx.params.id); if (!s) throw new HttpError(404, 'Unknown scenario'); return { body: { scenario: s, disclaimer: 'Research scenario. Not an operational advisory.' } }; });

  router.get('/api/v1/model-status', async () => {
    const status = modelStatus();
    const [ifs, aifs, wn2, smap] = await Promise.all([settled('ifs', providers.openMeteo.meta(providers.openMeteo.models.ecmwf_ifs025)), settled('aifs', providers.openMeteo.meta(providers.openMeteo.models.ecmwf_aifs025_single)), settled('wn2', providers.openMeteo.meta(providers.openMeteo.models.google_weathernext2_ensemble)), settled('smap', providers.smap.status())]);
    const freshness = { ecmwf_ifs025: ifs.status === 'available' ? ifs.value : { error: ifs.error }, ecmwf_aifs025_single: aifs.status === 'available' ? aifs.value : { error: aifs.error }, google_weathernext2_ensemble: wn2.status === 'available' ? wn2.value : { error: wn2.error }, smapL4: smap.status === 'available' ? { latestGranuleStart: smap.value.discovery?.latestGranules?.[0]?.timeStart ?? null, credentials: smap.value.credentials, retrieval: smap.value.retrieval } : { error: smap.error }, archivedRuns: store.forecastRuns.count() };
    const { metricsRaw, ...rest } = status;
    return { body: { ...rest, dataFreshness: freshness, weatherNext: providers.weatherNext, serviceVersion: version, releases: store.modelReleases.list() } };
  });
  router.get('/api/v1/model-status/metrics', () => { const m = modelStatus().metricsRaw; if (!m) throw new HttpError(404, 'No metrics file has been produced yet'); return { body: m }; });
  router.get('/api/v1/sources', async () => ({ body: { catchments: catchments.provenance, weather: Object.values(providers.openMeteo.models).map(m => ({ id: m.id, name: m.name, kind: m.kind, nativeResolutionM: m.nativeResolutionM, soilLayers: m.soilLayers, license: m.license, sourceUrl: m.sourceUrl, note: m.note ?? null })), discharge: { source: 'GloFAS v4 via Open-Meteo Flood API', role: 'riverine context only' }, soil: await providers.smap.status(), terrain: providers.terrain.product, exposure: providers.exposure.products, weatherNext: providers.weatherNext, labels: { source: 'Groundsource (Zenodo 10.5281/zenodo.18647054, CC BY 4.0)', role: 'historical labels only' }, notifications: notifications.providerStatus() } }));

  router.post('/api/v1/subscriptions', ctx => idempotent(ctx, 'subscriptions', () => notifications.createSubscription(ctx.body, ctx)));
  router.post('/api/v1/subscriptions/:id/verify', ctx => ({ body: notifications.verifySubscription(ctx.params.id, ctx.body, ctx) }));
  router.post('/api/v1/subscriptions/unsubscribe', ctx => { if (typeof ctx.body?.token !== 'string') throw new HttpError(400, 'token is required'); return { body: notifications.unsubscribe(ctx.body.token, ctx) }; });
  router.delete('/api/v1/subscriptions/:token', ctx => ({ body: notifications.unsubscribe(ctx.params.token, ctx) }));
  router.post('/api/v1/advisories', ctx => idempotent(ctx, 'advisories', () => notifications.createAdvisory(ctx.body, ctx)));
  router.get('/api/v1/advisories', ctx => { const id = ctx.query.get('catchmentId'); if (id) requireCatchment(id); return { body: { advisories: store.advisories.list(id) } }; });
  router.get('/api/v1/advisories/:id', ctx => { const a = notifications.get(ctx.params.id); if (!a) throw new HttpError(404, 'Unknown advisory'); return { body: { advisory: a } }; });
  router.post('/api/v1/advisories/:id/approve', ctx => ({ body: notifications.approveAdvisory(ctx.params.id, ctx.body, ctx) }));
  router.post('/api/v1/advisories/:id/cancel', ctx => ({ body: notifications.cancelAdvisory(ctx.params.id, ctx.body, ctx) }));
  router.get('/api/v1/advisories/:id/deliveries', ctx => { if (!notifications.get(ctx.params.id)) throw new HttpError(404, 'Unknown advisory'); return { body: { advisoryId: ctx.params.id, deliveries: store.deliveries.listForAdvisory(ctx.params.id) } }; });
  router.get('/api/v1/notifications/status', () => ({ body: notifications.providerStatus() }));
  router.get('/api/v1/audit', ctx => { requireAdmin(ctx); return { body: { entries: store.audit.list(Math.min(500, Number(ctx.query.get('limit')) || 100)) } }; });

  // Validation helper shared by legacy point routes.
  router.parseLatLon = query => {
    const latRaw = query.get('lat'), lonRaw = query.get('lon');
    if (!latRaw?.trim() || !lonRaw?.trim()) throw new HttpError(400, 'lat and lon are required');
    const lat = Number(latRaw), lon = Number(lonRaw);
    if (!inSupportedBbox(lat, lon)) throw new HttpError(400, 'Coordinates must be within the supported India bounding box (lat 6–38, lon 68–98)');
    return { lat: clamp(lat, -90, 90), lon: clamp(lon, -180, 180) };
  };
}
