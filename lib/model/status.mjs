// Model status and card. Reads datasets/model/metrics.json (written by scripts/train-baseline.mjs) when present.
// Until a calibrated release exists, the mode is 'demonstration' and flood probability stays null.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export const demoIndexDescription = { name: 'AEGIS classroom sensitivity index', version: 'demo-1.0', kind: 'uncalibrated weighted index', weights: { rainfall: 42, assumedSaturation: 30, slope: 12, builtUp: 10, treeCoverAbsence: 6, timelineIllustration: 9 }, isProbability: false, isMachineLearning: false };
export function loadModelStatus(root, config) {
  const metricsPath = join(root, 'datasets', 'model', 'metrics.json');
  const cardPath = join(root, 'docs', 'MODEL_CARD.md');
  let metrics = null;
  if (existsSync(metricsPath)) { try { metrics = JSON.parse(readFileSync(metricsPath, 'utf8')); } catch { metrics = null; } }
  const calibrated = Boolean(metrics?.calibration?.status === 'calibrated' && metrics?.release?.validated === true);
  const mode = calibrated ? 'validated' : metrics ? 'experimental' : 'demonstration';
  return {
    mode, outputLabel: mode === 'validated' ? 'validated' : mode === 'experimental' ? 'experimental (research only)' : 'demonstration',
    floodProbabilityAvailable: calibrated,
    modelName: metrics?.model?.name ?? 'aegis-catchment-baseline', modelVersion: metrics?.model?.version ?? null,
    trainingPeriod: metrics?.splits?.train?.period ?? null, evaluationPeriod: metrics?.splits?.test?.period ?? null, heldOutCatchments: metrics?.splits?.test?.catchments ?? null,
    supportedRegion: 'Ten HydroBASINS level-8 units in Indian hill regions (see /api/v1/catchments). No national coverage.',
    labels: metrics?.labels ?? { source: 'Groundsource (news-derived flood events, CC BY 4.0)', status: 'not processed', negativeLabels: 'never inferred from news absence' },
    calibration: metrics?.calibration ?? { status: 'not calibrated', method: null },
    ablation: metrics?.ablation ?? { status: 'not run', question: 'Does soil moisture improve calibration and useful lead time over weather-only?' },
    metrics: metrics?.results ?? null,
    dataFreshness: null,
    knownLimitations: [
      'Labels are news-derived and cover reported floods only; absence of a report is not a negative label, so precision is bounded, not measured.',
      'No basin routing, snowmelt, glacial-lake outburst, reservoir operation, debris or channel-capacity terms.',
      'Forecast rainfall on a 25 km grid does not resolve mountain convection; downscaling skill is unverified.',
      'Soil moisture from ECMWF/ERA5-Land layers is model soil, not measured soil; SMAP L4 is not yet ingested.',
      'The demonstration index on the map is a classroom sensitivity index, not a probability.'
    ],
    demonstrationIndex: demoIndexDescription,
    modelCard: existsSync(cardPath) ? '/docs/MODEL_CARD.md' : null, metricsFile: metrics ? '/api/v1/model-status/metrics' : null,
    metricsRaw: metrics,
    environment: config.NODE_ENV
  };
}
