#!/usr/bin/env node
// Baseline catchment flood-event models and the soil-moisture ablation.
//
// Inputs:  datasets/history/<id>.json   (daily precipitation and soil wetness; scripts/ingest-power.mjs or scripts/ingest-history.mjs)
//          datasets/labels/groundsource_events.json (news-derived events, scripts/groundsource.py)
// Outputs: datasets/model/metrics.json, datasets/model/weights.json, docs/MODEL_CARD.md
//
// Design choices that matter for honesty:
// * Labels are POSITIVE-UNLABELED. A day without a report is 'unlabeled', never 'negative'. Metrics that need
//   negatives (AUC, precision, Brier, reliability) are computed with unlabeled days as *presumed* non-events and are
//   reported as PU-biased bounds. Calibration therefore cannot be completed; flood probability stays null.
// * Weather-only and weather-plus-soil models share the exact same rows, labels, splits, regularisation and optimiser.
// * Splits avoid leakage: held-out catchments (spatial) and a held-out future period (temporal); features never look
//   past the prediction day; per-catchment soil climatology is computed without labels.
// * Reanalysis (NASA POWER / MERRA-2 or ERA5-Land) stands in for forecasts, so lead-time results are an UPPER bound on forecast-driven skill.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const VERSION = args.version || '0.1.0-experimental';
const HELD_OUT = (args.heldOut || 'manali,tawang,ooty').split(',');
const TRAIN_END = args.trainEnd || '2018-12-31', VALID_END = args.validEnd || '2020-12-31';
const ALERT_RATES = [0.01, 0.02, 0.05];
const catchments = JSON.parse(readFileSync(join(root, 'datasets', 'catchments.geojson'), 'utf8'));
const labels = JSON.parse(readFileSync(join(root, 'datasets', 'labels', 'groundsource_events.json'), 'utf8'));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const dayMs = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00Z') + n * dayMs).toISOString().slice(0, 10);

// ---------- feature table ----------
function buildRows(catchmentId) {
  const path = join(root, 'datasets', 'history', `${catchmentId}.json`);
  if (!existsSync(path)) return [];
  const hist = JSON.parse(readFileSync(path, 'utf8'));
  const rows = hist.rows;
  const byDate = new Map(rows.map((r, i) => [r.date, i]));
  // Unsupervised soil climatology per calendar month (no labels used).
  const clim = {};
  for (const r of rows) { const m = r.date.slice(5, 7); (clim[m] ||= { a: [], b: [] }); if (finite(r.soilSurface)) clim[m].a.push(r.soilSurface); if (finite(r.soilRoot)) clim[m].b.push(r.soilRoot); }
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  for (const m of Object.keys(clim)) clim[m] = { a: mean(clim[m].a), b: mean(clim[m].b) };
  const events = labels.catchments[catchmentId]?.events ?? [];
  const local = new Map(), regional = new Set(), severe = new Set(), eventStart = new Map();
  for (const e of events) {
    for (let d = e.startDate; d <= e.endDate; d = addDays(d, 1)) { if (e.tier === 'local') { local.set(d, e); if (e.reportCount >= 3) severe.add(d); } else regional.add(d); }
    if (e.tier === 'local') eventStart.set(e.startDate, e);
  }
  const win = (i, n, key) => { const v = []; for (let k = i - n + 1; k <= i; k++) { if (k < 0) return null; const x = rows[k][key]; if (!finite(x)) return null; v.push(x); } return v; };
  const out = [];
  for (let i = 30; i < rows.length; i++) {
    const r = rows[i], date = r.date, month = Number(date.slice(5, 7));
    const p0 = finite(r.precipitationMm) ? r.precipitationMm : null;
    const p1 = finite(rows[i - 1].precipitationMm) ? rows[i - 1].precipitationMm : null;
    const w3 = win(i, 3, 'precipitationMm'), w7 = win(i, 7, 'precipitationMm'), w30 = win(i, 30, 'precipitationMm');
    const w3l = win(i - 1, 3, 'precipitationMm'), w7l = win(i - 1, 7, 'precipitationMm'), w30l = win(i - 1, 30, 'precipitationMm');
    const sA = rows[i - 1].soilSurface, sB = rows[i - 1].soilRoot, sA2 = rows[i - 2].soilSurface, sB2 = rows[i - 2].soilRoot;
    const m = date.slice(5, 7);
    const feats = {
      lag0: { p0, p1, p3: w3 && w3.reduce((a, b) => a + b, 0), p7: w7 && w7.reduce((a, b) => a + b, 0), p30: w30 && w30.reduce((a, b) => a + b, 0), pmax3: w3 && Math.max(...w3), sinM: Math.sin(2 * Math.PI * month / 12), cosM: Math.cos(2 * Math.PI * month / 12) },
      lag1: { p0: p1, p1: finite(rows[i - 2].precipitationMm) ? rows[i - 2].precipitationMm : null, p3: w3l && w3l.reduce((a, b) => a + b, 0), p7: w7l && w7l.reduce((a, b) => a + b, 0), p30: w30l && w30l.reduce((a, b) => a + b, 0), pmax3: w3l && Math.max(...w3l), sinM: Math.sin(2 * Math.PI * month / 12), cosM: Math.cos(2 * Math.PI * month / 12) },
      soil0: { sA: finite(sA) ? sA : null, sB: finite(sB) ? sB : null, sAanom: finite(sA) && clim[m]?.a != null ? sA - clim[m].a : null, sBanom: finite(sB) && clim[m]?.b != null ? sB - clim[m].b : null },
      soil1: { sA: finite(sA2) ? sA2 : null, sB: finite(sB2) ? sB2 : null, sAanom: finite(sA2) && clim[m]?.a != null ? sA2 - clim[m].a : null, sBanom: finite(sB2) && clim[m]?.b != null ? sB2 - clim[m].b : null }
    };
    const y = local.has(date) ? 1 : regional.has(date) ? null : 0; // 0 = unlabeled (presumed non-event), null = masked
    out.push({ catchmentId, date, y, severe: severe.has(date), eventStart: eventStart.has(date), feats });
  }
  return out;
}
const historyMeta = catchments.features.map(f => { const p = join(root, 'datasets', 'history', `${f.id}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }).find(Boolean);
const allRows = catchments.features.flatMap(f => buildRows(f.id));
if (!allRows.length) { console.error('No history rows found. Run scripts/ingest-history.mjs first.'); process.exit(1); }

// ---------- model ----------
const WEATHER = ['p0', 'p1', 'p3', 'p7', 'p30', 'pmax3', 'sinM', 'cosM'], SOIL = ['sA', 'sB', 'sAanom', 'sBanom'];
function vector(row, lag, withSoil) { const w = row.feats[lag === 0 ? 'lag0' : 'lag1'], s = row.feats[lag === 0 ? 'soil0' : 'soil1']; const v = WEATHER.map(k => w[k]); if (withSoil) v.push(...SOIL.map(k => s[k])); return v.every(finite) ? v : null; }
function standardizer(vectors) { const n = vectors[0].length, mu = Array(n).fill(0), sd = Array(n).fill(0); for (const v of vectors) v.forEach((x, i) => mu[i] += x / vectors.length); for (const v of vectors) v.forEach((x, i) => sd[i] += (x - mu[i]) ** 2 / vectors.length); return { mu, sd: sd.map(s => Math.sqrt(s) || 1), apply: v => v.map((x, i) => (x - mu[i]) / sd[i]) }; }
function trainLogistic(X, y, { l2 = 1e-3, epochs = 400, lr = 0.05 } = {}) {
  const n = X[0].length; let w = Array(n).fill(0), b = 0;
  const pos = y.filter(v => v === 1).length, neg = y.length - pos, wPos = neg / Math.max(pos, 1); // class weighting for rare positives
  for (let e = 0; e < epochs; e++) {
    const gw = Array(n).fill(0); let gb = 0, total = 0;
    for (let i = 0; i < X.length; i++) { const z = X[i].reduce((s, x, k) => s + x * w[k], b); const p = 1 / (1 + Math.exp(-z)); const wt = y[i] === 1 ? wPos : 1; const g = (p - y[i]) * wt; total += wt; for (let k = 0; k < n; k++) gw[k] += g * X[i][k]; gb += g; }
    for (let k = 0; k < n; k++) w[k] -= lr * (gw[k] / total + l2 * w[k]); b -= lr * gb / total;
  }
  return { w, b, predict: x => 1 / (1 + Math.exp(-(x.reduce((s, v, k) => s + v * w[k], b)))) };
}
// ---------- metrics (PU-aware) ----------
function auc(scores, y) { const pairs = scores.map((s, i) => [s, y[i]]).sort((a, b) => b[0] - a[0]); let pos = 0, neg = 0, sum = 0; for (const [, l] of pairs) if (l === 1) pos++; else neg++; if (!pos || !neg) return null; let seenNeg = 0, tied = 0; for (let i = 0; i < pairs.length; i++) { /* rank-based with tie handling */ } const ranks = new Array(pairs.length); for (let i = 0; i < pairs.length;) { let j = i; while (j + 1 < pairs.length && pairs[j + 1][0] === pairs[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r; i = j + 1; } let rankSumPos = 0; pairs.forEach(([, l], i) => { if (l === 1) rankSumPos += ranks[i]; }); const U = pos * neg + pos * (pos + 1) / 2 - rankSumPos; return U / (pos * neg); }
function atAlertRate(scores, rows, rate) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const k = Math.max(1, Math.round(rate * idx.length)), threshold = scores[idx[k - 1]];
  const flagged = new Set(idx.slice(0, k));
  const pos = rows.filter(r => r.y === 1), tp = pos.filter((r, i) => flagged.has(rows.indexOf(r))).length;
  let flaggedUnlabeled = 0, months = new Set();
  rows.forEach((r, i) => { months.add(r.catchmentId + r.date.slice(0, 7)); if (flagged.has(i) && r.y === 0) flaggedUnlabeled++; });
  const severeRows = rows.map((r, i) => [r, i]).filter(([r]) => r.y === 1 && r.severe);
  const starts = rows.map((r, i) => [r, i]).filter(([r]) => r.eventStart);
  return { alertRate: rate, threshold: Math.round(threshold * 1e4) / 1e4, flagged: k, recallEventDays: pos.length ? tp / pos.length : null, precisionLowerBound: k ? (k - flaggedUnlabeled) / k : null, alertsOnUnlabeledDaysPerBasinMonth: months.size ? flaggedUnlabeled / months.size : null, recallSevereEventDays: severeRows.length ? severeRows.filter(([, i]) => flagged.has(i)).length / severeRows.length : null, recallEventStartDays: starts.length ? starts.filter(([, i]) => flagged.has(i)).length / starts.length : null, missedSevereEventDays: severeRows.filter(([, i]) => !flagged.has(i)).length };
}
function brier(scores, y) { return scores.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / scores.length; }
function reliability(scores, y, bins = 10) { const out = []; for (let b = 0; b < bins; b++) { const lo = b / bins, hi = (b + 1) / bins; const idx = scores.map((s, i) => i).filter(i => scores[i] >= lo && (scores[i] < hi || (b === bins - 1 && scores[i] <= hi))); if (!idx.length) continue; out.push({ bin: `${lo.toFixed(1)}–${hi.toFixed(1)}`, n: idx.length, meanPredicted: idx.reduce((s, i) => s + scores[i], 0) / idx.length, observedPositiveRateLowerBound: idx.filter(i => y[i] === 1).length / idx.length }); } return out; }
function evaluate(model, std, rows, lag, withSoil, fallback) {
  const usable = rows.filter(r => r.y !== null);
  const scores = [], kept = [], fell = { toWeatherOnly: 0, dropped: 0 };
  for (const r of usable) { let v = vector(r, lag, withSoil); if (!v && withSoil && fallback) { const vw = vector(r, lag, false); if (vw) { scores.push(fallback.model.predict(fallback.std.apply(vw))); kept.push(r); fell.toWeatherOnly++; continue; } } if (!v) { fell.dropped++; continue; } scores.push(model.predict(std.apply(v))); kept.push(r); }
  const y = kept.map(r => r.y);
  return { rows: kept.length, positives: y.filter(v => v === 1).length, unlabeled: y.filter(v => v === 0).length, masked: rows.length - usable.length, missingData: fell, puAuc: auc(scores, y), puBrier: brier(scores, y), reliability: reliability(scores, y), alerts: ALERT_RATES.map(rate => atAlertRate(scores, kept, rate)) };
}
function bootstrapDelta(rowsByYear, fnA, fnB, iterations = 200, seed = 42) {
  let s = seed; const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const years = [...rowsByYear.keys()]; const deltasAuc = [], deltasRecall = [];
  for (let it = 0; it < iterations; it++) { const sample = Array.from({ length: years.length }, () => years[Math.floor(rand() * years.length)]).flatMap(y => rowsByYear.get(y)); const a = fnA(sample), b = fnB(sample); if (a.puAuc != null && b.puAuc != null) deltasAuc.push(b.puAuc - a.puAuc); const ra = a.alerts[2].recallEventDays, rb = b.alerts[2].recallEventDays; if (ra != null && rb != null) deltasRecall.push(rb - ra); }
  const q = (arr, p) => { if (!arr.length) return null; const s2 = [...arr].sort((x, y) => x - y); return s2[Math.min(s2.length - 1, Math.floor(p * s2.length))]; };
  return { iterations, aucDelta: { median: q(deltasAuc, .5), p5: q(deltasAuc, .05), p95: q(deltasAuc, .95) }, recallAt5pctDelta: { median: q(deltasRecall, .5), p5: q(deltasRecall, .05), p95: q(deltasRecall, .95) } };
}
// ---------- splits ----------
const isHeld = r => HELD_OUT.includes(r.catchmentId);
const train = allRows.filter(r => !isHeld(r) && r.date <= TRAIN_END && r.y !== null);
const valid = allRows.filter(r => !isHeld(r) && r.date > TRAIN_END && r.date <= VALID_END);
const testFuture = allRows.filter(r => !isHeld(r) && r.date > VALID_END);
const testSpatial = allRows.filter(r => isHeld(r));
const testSpatioTemporal = allRows.filter(r => isHeld(r) && r.date > VALID_END);
console.error(`rows total ${allRows.length} · train ${train.length} (pos ${train.filter(r => r.y === 1).length}) · valid ${valid.length} · test-future ${testFuture.length} (pos ${testFuture.filter(r => r.y === 1).length}) · test-spatial ${testSpatial.length} (pos ${testSpatial.filter(r => r.y === 1).length})`);
const configs = {};
for (const lag of [0, 1]) for (const withSoil of [false, true]) {
  const pairs = train.map(r => [vector(r, lag, withSoil), r.y]).filter(([v]) => v);
  const std = standardizer(pairs.map(([v]) => v));
  const model = trainLogistic(pairs.map(([v]) => std.apply(v)), pairs.map(([, y]) => y));
  configs[`${withSoil ? 'weather+soil' : 'weather-only'}:lead${lag}d`] = { lag, withSoil, model, std, trainRows: pairs.length };
}
const results = {};
for (const [name, cfg] of Object.entries(configs)) {
  const fallback = cfg.withSoil ? configs[`weather-only:lead${cfg.lag}d`] : null;
  results[name] = { trainRows: cfg.trainRows, features: cfg.withSoil ? [...WEATHER, ...SOIL] : WEATHER, weights: Object.fromEntries((cfg.withSoil ? [...WEATHER, ...SOIL] : WEATHER).map((k, i) => [k, Math.round(cfg.model.w[i] * 1e4) / 1e4])), bias: cfg.model.b,
    validation: evaluate(cfg.model, cfg.std, valid, cfg.lag, cfg.withSoil, fallback), testFuture: evaluate(cfg.model, cfg.std, testFuture, cfg.lag, cfg.withSoil, fallback), testHeldOutCatchments: evaluate(cfg.model, cfg.std, testSpatial, cfg.lag, cfg.withSoil, fallback), testHeldOutCatchmentsFuture: evaluate(cfg.model, cfg.std, testSpatioTemporal, cfg.lag, cfg.withSoil, fallback) };
}
const byYear = rows => { const m = new Map(); for (const r of rows) { const y = r.date.slice(0, 4); if (!m.has(y)) m.set(y, []); m.get(y).push(r); } return m; };
const ablation = {};
for (const lag of [0, 1]) {
  const A = configs[`weather-only:lead${lag}d`], B = configs[`weather+soil:lead${lag}d`];
  ablation[`lead${lag}d`] = { testFuture: bootstrapDelta(byYear(testFuture), s => evaluate(A.model, A.std, s, lag, false), s => evaluate(B.model, B.std, s, lag, true, A)), testHeldOutCatchments: bootstrapDelta(byYear(testSpatial), s => evaluate(A.model, A.std, s, lag, false), s => evaluate(B.model, B.std, s, lag, true, A)) };
}
const verdict = (() => { const f = ablation.lead1d.testFuture, h = ablation.lead1d.testHeldOutCatchments; const improves = d => d.p5 != null && d.p5 > 0; const worsens = d => d.p95 != null && d.p95 < 0; if (improves(f.aucDelta) && improves(h.aucDelta)) return 'Soil features improve PU-AUC at 1-day lead on both the future period and held-out catchments (90% bootstrap interval excludes zero). Recall at a 5% alert rate: see recallAt5pctDelta.'; if (worsens(f.aucDelta) || worsens(h.aucDelta)) return 'Soil features do not help: at least one test set shows a significant PU-AUC decrease at 1-day lead.'; return 'Inconclusive: the 90% bootstrap interval for the soil-vs-weather-only difference includes zero on at least one test set. The demo slider response is not evidence of benefit.'; })();
const positivesByYear = {}; for (const r of allRows) if (r.y === 1) positivesByYear[r.date.slice(0, 4)] = (positivesByYear[r.date.slice(0, 4)] || 0) + 1;
const metrics = {
  model: { name: 'aegis-catchment-baseline', version: VERSION, kind: 'class-weighted L2 logistic regression, full-batch gradient descent (pure JS, no dependencies)', trainedAt: new Date().toISOString(), labelType: 'positive-unlabeled (event days vs unlabeled days); regional-tier report days masked' },
  release: { validated: false, status: 'experimental', reason: 'PU labels from news reports: true negatives are unknown, so precision, Brier and reliability are bounds, not measurements. Reanalysis features, not forecasts. Ten catchments only.' },
  calibration: { status: 'not calibrated', method: null, reason: 'Observed positive rates are lower bounds (unreported events exist); calibrating to them would systematically understate risk. Flood probability remains null.' },
  data: { features: { source: historyMeta?.source ?? 'unknown', datasetVersion: historyMeta?.datasetVersion ?? null, resolution: historyMeta?.nativeResolution ?? 'see history file', variables: historyMeta?.variables ?? null, catchmentAggregation: historyMeta?.requestPoint?.basis ?? 'mean of sample cells' }, labels: { source: 'Groundsource (Zenodo 10.5281/zenodo.18647054, CC BY 4.0)', processedFile: 'datasets/labels/groundsource_events.json', md5: labels.dataset.md5, positiveDefinition: 'days inside a local-tier deduplicated event window', masked: 'days inside regional-tier (large-area) reports', negatives: 'none; unlabeled days are presumed non-events for ranking metrics only', positivesByYear, coverageBias: 'positives rise sharply after 2015, consistent with growing news/geocoding coverage rather than more floods' } },
  splits: { heldOutCatchments: HELD_OUT, trainCatchments: catchments.features.map(f => f.id).filter(id => !HELD_OUT.includes(id)), train: { period: `${allRows[0]?.date ?? ''}..${TRAIN_END}`, rows: train.length, positives: train.filter(r => r.y === 1).length }, validation: { period: `${addDays(TRAIN_END, 1)}..${VALID_END}`, rows: valid.length, positives: valid.filter(r => r.y === 1).length }, test: { period: `${addDays(VALID_END, 1)}..${allRows.at(-1)?.date ?? ''}`, catchments: HELD_OUT, future: { rows: testFuture.length, positives: testFuture.filter(r => r.y === 1).length }, heldOutCatchments: { rows: testSpatial.length, positives: testSpatial.filter(r => r.y === 1).length }, heldOutCatchmentsFuture: { rows: testSpatioTemporal.length, positives: testSpatioTemporal.filter(r => r.y === 1).length } }, leakageControls: ['features use only data up to the prediction day (lead0) or the previous day (lead1)', 'soil climatology is computed per catchment without labels', 'standardisation statistics come from the training rows only', 'held-out catchments are never used for training or threshold selection'] },
  leadTime: { lead0d: 'features through the event day (nowcast, reanalysis)', lead1d: 'features through the previous day (1-day lead, reanalysis upper bound on forecast skill)', note: 'Real lead time requires archived forecast runs (see forecast_runs table); reanalysis overstates achievable skill.' },
  distributionShift: { question: 'Do news-derived (often urban) reports transfer to mountain torrents?', evidence: { positivesByYear, heldOutCatchmentsVsFuture: 'compare testHeldOutCatchments with testFuture below; a large gap indicates basin-specific reporting patterns rather than transferable hydrology' } },
  ensembleDisagreement: { status: 'not evaluated in training', reason: 'Training uses a single reanalysis; ensemble spread is available operationally from the WeatherNext 2 ensemble in /api/v1/catchments/:id/forecast and is reported there, not converted into probability.' },
  results, ablation: { ...ablation, verdict, method: 'Paired bootstrap over test years (200 resamples); weather+soil rows lacking soil fall back to the weather-only model (counted in missingData.toWeatherOnly).' },
  uncertaintyIntervals: 'ablation.*.aucDelta and recallAt5pctDelta carry 5th/95th percentile bootstrap bounds.',
  limitations: ['Ten catchments; no national coverage.', 'Positive-unlabeled labels: false-alarm rates are upper bounds, precision lower bounds.', 'Reanalysis features (0.5° MERRA-2 land model via NASA POWER); no forecast error included; coarse grid does not resolve mountain convection.', 'No routing, snowmelt, GLOF, reservoir or debris processes.', 'Reporting bias grows over time, inflating apparent skill in later years.']
};
mkdirSync(join(root, 'datasets', 'model'), { recursive: true });
writeFileSync(join(root, 'datasets', 'model', 'metrics.json'), JSON.stringify(metrics, null, 1));
writeFileSync(join(root, 'datasets', 'model', 'weights.json'), JSON.stringify(Object.fromEntries(Object.entries(configs).map(([k, c]) => [k, { w: c.model.w, b: c.model.b, mu: c.std.mu, sd: c.std.sd, features: c.withSoil ? [...WEATHER, ...SOIL] : WEATHER }])), null, 1));
const f = v => (v == null ? 'n/a' : typeof v === 'number' ? v.toFixed(3) : String(v));
const table = (set) => ['| Configuration | rows | positives | PU-AUC | recall@1% | recall@5% | precision LB@5% | alerts on unlabeled days / basin-month @5% | severe-day recall@5% | soil fallback rows |', '|---|---|---|---|---|---|---|---|---|---|', ...Object.entries(results).map(([name, r]) => { const e = r[set]; const a5 = e.alerts[2], a1 = e.alerts[0]; return `| ${name} | ${e.rows} | ${e.positives} | ${f(e.puAuc)} | ${f(a1.recallEventDays)} | ${f(a5.recallEventDays)} | ${f(a5.precisionLowerBound)} | ${f(a5.alertsOnUnlabeledDaysPerBasinMonth)} | ${f(a5.recallSevereEventDays)} | ${e.missingData.toWeatherOnly} |`; })].join('\n');
const card = `# Model card: ${metrics.model.name} ${VERSION}

Generated ${metrics.model.trainedAt} by \`scripts/train-baseline.mjs\`. Machine-readable metrics: \`datasets/model/metrics.json\` (served at \`/api/v1/model-status/metrics\`).

## Status

- **Release status: experimental. Not validated. Not calibrated. Flood probability stays null.**
- Model: ${metrics.model.kind}.
- Labels: ${metrics.model.labelType}. Negatives are never inferred from the absence of a news report.
- Features: ${metrics.data.features.source} (reanalysis, not forecasts). Lead-time figures are therefore an upper bound. Soil inputs are model wetness/water states, not measurements.
- Supported region: ten HydroBASINS level-8 units (\`/api/v1/catchments\`). No national coverage.

## Data

- Labels: Groundsource (Zenodo 10.5281/zenodo.18647054, CC BY 4.0), MD5 \`${labels.dataset.md5}\`, ${labels.dataset.rows.toLocaleString('en-IN')} rows, ${labels.dataset.eventsIntersectingIndiaBbox.toLocaleString('en-IN')} intersecting the India bounding box. Per-catchment intersection, tiering and deduplication are described in \`datasets/labels/groundsource_events.json\`.
- Positive event days by year (all ten catchments, local tier): ${Object.entries(positivesByYear).map(([y, n]) => `${y}: ${n}`).join(', ')}. The steep rise after 2015 reflects reporting and geocoding coverage, not hydrology.
- Features: ${metrics.data.features.source}; ${metrics.data.features.resolution}; ${metrics.data.features.datasetVersion}.

## Splits (identical for every configuration)

- Held-out catchments: ${HELD_OUT.join(', ')}. Training catchments: ${metrics.splits.trainCatchments.join(', ')}.
- Train ${metrics.splits.train.period} (${metrics.splits.train.rows} rows, ${metrics.splits.train.positives} positives); validation ${metrics.splits.validation.period}; test ${metrics.splits.test.period}.
- Leakage controls: ${metrics.splits.leakageControls.join('; ')}.

## Results: held-out future period, training catchments

${table('testFuture')}

## Results: held-out catchments (all years)

${table('testHeldOutCatchments')}

## Results: held-out catchments, future period

${table('testHeldOutCatchmentsFuture')}

## Soil-moisture ablation (weather-only vs weather+soil, same rows, labels, splits)

- 1-day lead, future period: PU-AUC delta median ${f(ablation.lead1d.testFuture.aucDelta.median)} (90% bootstrap ${f(ablation.lead1d.testFuture.aucDelta.p5)} to ${f(ablation.lead1d.testFuture.aucDelta.p95)}); recall@5% delta median ${f(ablation.lead1d.testFuture.recallAt5pctDelta.median)} (${f(ablation.lead1d.testFuture.recallAt5pctDelta.p5)} to ${f(ablation.lead1d.testFuture.recallAt5pctDelta.p95)}).
- 1-day lead, held-out catchments: PU-AUC delta median ${f(ablation.lead1d.testHeldOutCatchments.aucDelta.median)} (${f(ablation.lead1d.testHeldOutCatchments.aucDelta.p5)} to ${f(ablation.lead1d.testHeldOutCatchments.aucDelta.p95)}); recall@5% delta median ${f(ablation.lead1d.testHeldOutCatchments.recallAt5pctDelta.median)} (${f(ablation.lead1d.testHeldOutCatchments.recallAt5pctDelta.p5)} to ${f(ablation.lead1d.testHeldOutCatchments.recallAt5pctDelta.p95)}).
- Nowcast (lead 0): PU-AUC delta median ${f(ablation.lead0d.testFuture.aucDelta.median)} (future) and ${f(ablation.lead0d.testHeldOutCatchments.aucDelta.median)} (held-out catchments).
- **Verdict: ${verdict}**

## Calibration

${metrics.calibration.reason} Reliability bins (predicted vs observed lower-bound rate) are stored in metrics.json for every configuration and test set.

## What is and is not validated

- Validated: the data pipeline (checksums, provenance, split integrity, missing-data fallback) and the reported ranking metrics under the PU assumption.
- Not validated: any probability of flooding, any lead-time claim under real forecast error, transfer to catchments outside the ten, severe-event skill beyond the small severe subset, and behaviour during snowmelt, GLOF, dam or debris events.
- Ensemble disagreement: ${metrics.ensembleDisagreement.reason}

## Limitations

${metrics.limitations.map(l => `- ${l}`).join('\n')}
`;
writeFileSync(join(root, 'docs', 'MODEL_CARD.md'), card);
console.error(`Wrote datasets/model/metrics.json, datasets/model/weights.json, docs/MODEL_CARD.md\nVerdict: ${verdict}`);
