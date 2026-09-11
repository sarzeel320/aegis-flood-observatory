import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRun, models } from '../lib/providers/openmeteo.mjs';
import { buildForecastPayload } from '../lib/forecast.mjs';
import { loadModelStatus } from '../lib/model/status.mjs';
import { fixtures, root, testConfig } from './helpers.mjs';
import { loadCatchments } from '../lib/catchments.mjs';
const fx = fixtures();
test('catchment aggregation collapses duplicate cells, averages distinct cells and preserves missing values', () => {
  const { series, gridCells } = aggregateRun([...fx.ifs, fx.ifs[0]], models.ecmwf_ifs025);
  assert.equal(gridCells.length, 2);
  assert.equal(series.stepSeconds, 10800);
  assert.equal(series.times[0], '2026-09-12T00:00Z');
  assert.equal(series.precipitationMm[5], 1.5, 'a missing cell is excluded from the mean, not treated as zero (mean of the remaining cell)');
  assert.equal(series.precipitationSpread.cellsAvailable[5], 1);
  assert.equal(series.precipitationMm[2], 0.4);
  assert.deepEqual(Object.keys(series.soil), ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm', 'soil_moisture_100_to_255cm']);
  assert.equal(series.soil.soil_moisture_0_to_7cm.topCm, 0); assert.equal(series.soil.soil_moisture_0_to_7cm.unit, 'm³/m³');
});
test('ensemble statistics are computed across members per step', () => {
  const { series } = aggregateRun(fx.ensemble, models.google_weathernext2_ensemble);
  assert.equal(series.ensemble.memberCount, 3);
  assert.equal(series.precipitationMm[0], 1);
  assert.ok(series.ensemble.p10[0] < series.ensemble.p90[0]);
  assert.equal(series.ensemble.min[0], 0.5); assert.equal(series.ensemble.max[0], 1.5);
});
test('forecast payload keeps probability null, aligns discharge by date, flags missing steps and lists provenance', () => {
  const catchments = loadCatchments(root);
  const catchment = catchments.get('kedarnath');
  const { series, gridCells, units } = aggregateRun(fx.ifs, models.ecmwf_ifs025);
  const run = { runId: 'r1', model: 'ecmwf_ifs025', modelName: 'ECMWF IFS 0.25°', kind: 'physics-deterministic', provider: 'Open-Meteo', issuedAt: '2026-09-11T18:00:00.000Z', retrievedAt: '2026-09-12T00:10:00.000Z', validFrom: series.times[0], validTo: series.times.at(-1), stepSeconds: 10800, nativeResolutionM: 25000, gridCells, units, series, license: 'x', sourceUrl: 'https://open-meteo.com', fromArchive: false };
  const discharge = { status: 'available', retrievedAt: '2026-09-12T00:10:00.000Z', times: ['2026-09-12T00:00Z', '2026-09-13T00:00Z'], dischargeM3S: [6.4, null], nativeResolutionM: 5000, provenance: { source: 'GloFAS', datasetVersion: 'v4', quality: 'forecast', licenseUrl: 'x' } };
  const payload = buildForecastPayload({ catchment, runs: [{ status: 'available', run }, { status: 'unavailable', model: 'ecmwf_aifs025_single', error: 'down' }], discharge, smap: { status: 'missing', provenance: { source: 'SMAP', quality: 'missing' } }, modelStatus: loadModelStatus(root, testConfig()), now: new Date('2026-09-12T00:00:00Z') });
  assert.ok(['demonstration', 'experimental'].includes(payload.mode)); assert.notEqual(payload.mode, 'validated');
  assert.ok(payload.floodProbability.every(v => v === null)); assert.ok(payload.soilSaturationFraction.every(v => v === null));
  assert.equal(payload.times.length, 16); assert.equal(payload.precipitationMm[5], 1.5);
  assert.equal(payload.dischargeM3S[0], 6.4); assert.equal(payload.dischargeM3S[8], null, 'missing GloFAS day stays null');
  assert.ok(payload.qualityFlags[0].length === 0 || payload.qualityFlags[0].every(f => typeof f === 'string'));
  assert.equal(payload.models[1].status, 'unavailable');
  assert.equal(payload.coordinateOrder, 'longitude,latitude');
  const roles = payload.provenance.map(p => p.role);
  assert.ok(roles.includes('catchment geometry') && roles.includes('primary precipitation and soil series') && roles.includes('riverine discharge context'));
  for (const p of payload.provenance.filter(p => p.role !== 'SMAP L4 soil moisture')) assert.ok('quality' in p && 'licenseUrl' in p && 'datasetVersion' in p, 'provenance fields present');
  assert.ok(payload.limitations.some(l => /null/.test(l)));
});
test('forecast payload with no provider run is an explicit failure state', () => {
  const catchments = loadCatchments(root);
  const payload = buildForecastPayload({ catchment: catchments.get('ooty'), runs: [{ status: 'unavailable', model: 'ecmwf_ifs025', error: 'down' }], discharge: { status: 'unavailable' }, smap: { status: 'missing' }, modelStatus: loadModelStatus(root, testConfig()) });
  assert.equal(payload.times.length, 0);
  assert.ok(payload.limitations.some(l => /failure state/.test(l)));
});
test('model status stays demonstration without a calibrated release', () => {
  const status = loadModelStatus(root, testConfig());
  assert.ok(['demonstration', 'experimental'].includes(status.mode));
  assert.equal(status.floodProbabilityAvailable, false);
  assert.equal(status.demonstrationIndex.isProbability, false);
});
