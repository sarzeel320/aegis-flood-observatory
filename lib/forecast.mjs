// Assemble the CatchmentForecast contract from archived forecast runs, GloFAS discharge, soil layers and model status.
// Every payload carries provenance, issue/valid times, native resolution, quality flags and limitations.
const finite = n => typeof n === 'number' && Number.isFinite(n);
function provenanceFor(run) {
  return { source: `${run.provider} distribution of ${run.modelName}`, model: run.model, datasetVersion: run.issuedAt ? `run ${run.issuedAt}` : 'run time unknown', retrievedAt: run.retrievedAt, issuedAt: run.issuedAt, validAt: run.validFrom, validTo: run.validTo, nativeResolutionM: run.nativeResolutionM, stepSeconds: run.stepSeconds, gridCells: run.gridCells.length, quality: 'forecast', licenseUrl: run.sourceUrl, license: run.license, archivedRunId: run.runId, servedFrom: run.fromArchive ? (run.stale ? 'archive (stale: provider unavailable)' : 'archive') : 'provider (archived now)' };
}
export function buildForecastPayload({ catchment, runs, discharge, smap, modelStatus, now = new Date() }) {
  const primary = runs.find(r => r.status === 'available' && r.run.model === 'ecmwf_ifs025')?.run ?? runs.find(r => r.status === 'available')?.run ?? null;
  const times = primary?.series.times ?? [];
  const stepHours = primary?.stepSeconds ? primary.stepSeconds / 3600 : null;
  const dischargeByDate = new Map();
  if (discharge?.status === 'available') discharge.times.forEach((t, i) => dischargeByDate.set(t.slice(0, 10), discharge.dischargeM3S[i]));
  const qualityFlags = times.map((t, i) => {
    const flags = [];
    if (!primary || !finite(primary.series.precipitationMm[i])) flags.push('precipitation-missing');
    if (primary?.series.precipitationSpread?.cellsAvailable?.[i] < primary.gridCells.length) flags.push('partial-grid-coverage');
    if (Date.parse(t) < now.getTime() - (primary?.stepSeconds ?? 3600) * 1000) flags.push('valid-time-in-past');
    if (!Object.keys(primary?.series.soil ?? {}).length) flags.push('soil-missing');
    return flags;
  });
  const soilLayers = Object.entries(primary?.series.soil ?? {}).map(([key, layer]) => ({ key, topCm: layer.topCm, bottomCm: layer.bottomCm, unit: layer.unit, source: `${primary.modelName} land-surface layer (model soil, not observation)`, values: layer.values }));
  return {
    catchmentId: catchment.id, catchmentName: catchment.name, mode: modelStatus.mode, outputLabel: modelStatus.outputLabel, generatedAt: now.toISOString(),
    geometry: catchment.geometry, spatialReference: 'EPSG:4326', geometryEdition: catchment.edition, coordinateOrder: 'longitude,latitude',
    issuedAt: primary?.issuedAt ?? null, validFrom: primary?.validFrom ?? null, validTo: primary?.validTo ?? null, stepSeconds: primary?.stepSeconds ?? null, nativeResolutionM: primary?.nativeResolutionM ?? null,
    times,
    precipitationMm: primary?.series.precipitationMm ?? [], precipitationMmPerHour: stepHours ? primary.series.precipitationMm.map(v => (finite(v) ? Math.round(v / stepHours * 1000) / 1000 : null)) : [],
    precipitationCellSpread: primary?.series.precipitationSpread ?? null,
    soilVolumetricM3M3: soilLayers,
    soilSaturationFraction: times.map(() => null), soilSaturationNote: 'Volumetric water content is not converted to saturation: no site porosity/residual-water parameters are configured. Null by design.',
    smapL4: smap,
    floodProbability: times.map(() => null), probabilityInterval: times.map(() => null), floodProbabilityNote: modelStatus.floodProbabilityAvailable ? null : 'Null until a calibrated, validated model release exists. See /api/v1/model-status.',
    dischargeM3S: times.map(t => dischargeByDate.get(t.slice(0, 10)) ?? null), dischargeAlignment: 'GloFAS daily value repeated for each step of the same UTC date; riverine context only',
    discharge: discharge ?? { status: 'unavailable' },
    qualityFlags,
    models: runs.map(r => (r.status === 'available' ? { status: 'available', model: r.run.model, name: r.run.modelName, kind: r.run.kind, issuedAt: r.run.issuedAt, retrievedAt: r.run.retrievedAt, validFrom: r.run.validFrom, validTo: r.run.validTo, stepSeconds: r.run.stepSeconds, nativeResolutionM: r.run.nativeResolutionM, gridCells: r.run.gridCells.length, times: r.run.series.times, precipitationMm: r.run.series.precipitationMm, ensemble: r.run.series.ensemble ? { memberCount: r.run.series.ensemble.memberCount, p10: r.run.series.ensemble.p10, p90: r.run.series.ensemble.p90, min: r.run.series.ensemble.min, max: r.run.series.ensemble.max } : null, servedFrom: r.run.fromArchive ? 'archive' : 'provider', stale: Boolean(r.run.stale), note: r.run.note ?? null } : { status: 'unavailable', model: r.model, error: r.error })),
    modelStatus: { mode: modelStatus.mode, modelName: modelStatus.modelName, modelVersion: modelStatus.modelVersion, calibration: modelStatus.calibration.status, floodProbabilityAvailable: modelStatus.floodProbabilityAvailable, statusUrl: '/api/v1/model-status' },
    provenance: [
      { source: 'HydroSHEDS HydroBASINS', datasetVersion: catchment.edition, retrievedAt: null, issuedAt: null, validAt: null, nativeResolutionM: 450, quality: 'observed', licenseUrl: 'https://www.hydrosheds.org/page/license', role: 'catchment geometry' },
      ...runs.filter(r => r.status === 'available').map(r => ({ ...provenanceFor(r.run), role: r.run.model === primary?.model ? 'primary precipitation and soil series' : 'comparison model' })),
      ...(discharge?.status === 'available' ? [{ ...discharge.provenance, retrievedAt: discharge.retrievedAt, issuedAt: null, validAt: discharge.times[0], nativeResolutionM: discharge.nativeResolutionM, stepSeconds: 86400, role: 'riverine discharge context' }] : []),
      { ...(smap?.provenance ?? {}), role: 'SMAP L4 soil moisture', status: smap?.status ?? 'missing' }
    ],
    limitations: [
      'Precipitation is a catchment mean of 25 km grid cells at native model steps; it does not resolve convective cells or orographic gradients.',
      'Soil layers are land-surface-model states from the weather model, not field measurements. Depths differ from SMAP L4 layers.',
      'Flood probability is null: no calibrated model release exists. Nothing in this payload is an emergency warning.',
      'GloFAS discharge is daily riverine context, not an urban cloudburst footprint.',
      ...(primary?.stale ? ['Primary run served from the archive because the provider was unavailable; check issuedAt before use.'] : []),
      ...(primary ? [] : ['No forecast provider was available; all series are empty. This is a failure state, not a calm forecast.'])
    ]
  };
}
