# Model card: aegis-catchment-baseline 0.1.0-experimental

Generated 2026-09-11T05:42:10.963Z by `scripts/train-baseline.mjs`. Machine-readable metrics: `datasets/model/metrics.json` (served at `/api/v1/model-status/metrics`).

## Status

- **Release status: experimental. Not validated. Not calibrated. Flood probability stays null.**
- Model: class-weighted L2 logistic regression, full-batch gradient descent (pure JS, no dependencies).
- Labels: positive-unlabeled (event days vs unlabeled days); regional-tier report days masked. Negatives are never inferred from the absence of a news report.
- Features: NASA POWER daily point API (MERRA-2 land model; precipitation bias-corrected) (reanalysis, not forecasts). Lead-time figures are therefore an upper bound. Soil inputs are model wetness/water states, not measurements.
- Supported region: ten HydroBASINS level-8 units (`/api/v1/catchments`). No national coverage.

## Data

- Labels: Groundsource (Zenodo 10.5281/zenodo.18647054, CC BY 4.0), MD5 `cd1b5de6508f7aad8e1d1d0dd4cecea6`, 26,46,302 rows, 4,48,378 intersecting the India bounding box. Per-catchment intersection, tiering and deduplication are described in `datasets/labels/groundsource_events.json`.
- Positive event days by year (all ten catchments, local tier): 2005: 3, 2006: 4, 2007: 2, 2008: 1, 2009: 4, 2010: 21, 2011: 14, 2012: 28, 2013: 39, 2014: 62, 2015: 73, 2016: 42, 2017: 78, 2018: 147, 2019: 134, 2020: 93, 2021: 140, 2022: 220, 2023: 274, 2024: 379, 2025: 401. The steep rise after 2015 reflects reporting and geocoding coverage, not hydrology.
- Features: NASA POWER daily point API (MERRA-2 land model; precipitation bias-corrected); MERRA-2 0.5° × 0.625° grid; daily; local solar time; NASA/POWER Source Native Resolution Daily Data · API v2.9.7 · sources MERRA2 · retrieved 2026-09-11T05:40:54.235Z.

## Splits (identical for every configuration)

- Held-out catchments: manali, tawang, ooty. Training catchments: darjeeling, gangtok, shillong, kedarnath, mahabaleshwar, wayanad, srinagar.
- Train 2005-01-31..2018-12-31 (35327 rows, 368 positives); validation 2019-01-01..2020-12-31; test 2021-01-01..2025-12-31.
- Leakage controls: features use only data up to the prediction day (lead0) or the previous day (lead1); soil climatology is computed per catchment without labels; standardisation statistics come from the training rows only; held-out catchments are never used for training or threshold selection.

## Results: held-out future period, training catchments

| Configuration | rows | positives | PU-AUC | recall@1% | recall@5% | precision LB@5% | alerts on unlabeled days / basin-month @5% | severe-day recall@5% | soil fallback rows |
|---|---|---|---|---|---|---|---|---|---|
| weather-only:lead0d | 12422 | 986 | 0.812 | 0.050 | 0.200 | 0.317 | 1.010 | 0.228 | 0 |
| weather+soil:lead0d | 12422 | 986 | 0.775 | 0.045 | 0.166 | 0.264 | 1.088 | 0.230 | 0 |
| weather-only:lead1d | 12422 | 986 | 0.807 | 0.054 | 0.191 | 0.303 | 1.031 | 0.221 | 0 |
| weather+soil:lead1d | 12422 | 986 | 0.784 | 0.052 | 0.184 | 0.291 | 1.048 | 0.250 | 0 |

## Results: held-out catchments (all years)

| Configuration | rows | positives | PU-AUC | recall@1% | recall@5% | precision LB@5% | alerts on unlabeled days / basin-month @5% | severe-day recall@5% | soil fallback rows |
|---|---|---|---|---|---|---|---|---|---|
| weather-only:lead0d | 22867 | 663 | 0.791 | 0.104 | 0.299 | 0.173 | 1.250 | 0.407 | 0 |
| weather+soil:lead0d | 22867 | 663 | 0.798 | 0.095 | 0.255 | 0.148 | 1.288 | 0.341 | 0 |
| weather-only:lead1d | 22867 | 663 | 0.786 | 0.089 | 0.276 | 0.160 | 1.270 | 0.369 | 0 |
| weather+soil:lead1d | 22867 | 663 | 0.775 | 0.090 | 0.235 | 0.136 | 1.306 | 0.309 | 0 |

## Results: held-out catchments, future period

| Configuration | rows | positives | PU-AUC | recall@1% | recall@5% | precision LB@5% | alerts on unlabeled days / basin-month @5% | severe-day recall@5% | soil fallback rows |
|---|---|---|---|---|---|---|---|---|---|
| weather-only:lead0d | 5449 | 428 | 0.787 | 0.082 | 0.278 | 0.438 | 0.850 | 0.392 | 0 |
| weather+soil:lead0d | 5449 | 428 | 0.789 | 0.054 | 0.203 | 0.320 | 1.028 | 0.266 | 0 |
| weather-only:lead1d | 5449 | 428 | 0.783 | 0.072 | 0.276 | 0.434 | 0.856 | 0.388 | 0 |
| weather+soil:lead1d | 5449 | 428 | 0.768 | 0.061 | 0.210 | 0.331 | 1.011 | 0.293 | 0 |

## Soil-moisture ablation (weather-only vs weather+soil, same rows, labels, splits)

- 1-day lead, future period: PU-AUC delta median -0.024 (90% bootstrap -0.040 to -0.013); recall@5% delta median -0.005 (-0.038 to 0.011).
- 1-day lead, held-out catchments: PU-AUC delta median -0.013 (-0.036 to 0.006); recall@5% delta median -0.044 (-0.087 to -0.011).
- Nowcast (lead 0): PU-AUC delta median -0.037 (future) and 0.003 (held-out catchments).
- **Verdict: Soil features do not help: at least one test set shows a significant PU-AUC decrease at 1-day lead.**

## Calibration

Observed positive rates are lower bounds (unreported events exist); calibrating to them would systematically understate risk. Flood probability remains null. Reliability bins (predicted vs observed lower-bound rate) are stored in metrics.json for every configuration and test set.

## What is and is not validated

- Validated: the data pipeline (checksums, provenance, split integrity, missing-data fallback) and the reported ranking metrics under the PU assumption.
- Not validated: any probability of flooding, any lead-time claim under real forecast error, transfer to catchments outside the ten, severe-event skill beyond the small severe subset, and behaviour during snowmelt, GLOF, dam or debris events.
- Ensemble disagreement: Training uses a single reanalysis; ensemble spread is available operationally from the WeatherNext 2 ensemble in /api/v1/catchments/:id/forecast and is reported there, not converted into probability.

## Limitations

- Ten catchments; no national coverage.
- Positive-unlabeled labels: false-alarm rates are upper bounds, precision lower bounds.
- Reanalysis features (0.5° MERRA-2 land model via NASA POWER); no forecast error included; coarse grid does not resolve mountain convection.
- No routing, snowmelt, GLOF, reservoir or debris processes.
- Reporting bias grows over time, inflating apparent skill in later years.
