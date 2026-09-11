# Mountain flash-flood intelligence: data and model research

## Findings

The defensible prototype combines accessible weather, explicit synthetic risk scenarios and a geospatial frontend. A universal “best” model for India's mountain flash floods cannot be established from the reviewed evidence. Global weather skill, urban flood skill, river discharge skill and local inundation skill are different evaluation targets. A research prototype should expose that distinction rather than hide it behind a single accuracy percentage.

Research was checked against primary sources on 11 September 2026. The source dates and versions below matter: a recently released service is not necessarily accessible without an account, and a newly published data edition may contain older observations.

## Google flash-flood forecasting and Groundsource

Google announced urban flash-flood predictions with up to 24 hours of lead time in March 2026. The documented target is urban flash flooding. It is useful research precedent but does not establish accuracy in steep, ungauged Himalayan headwaters. That transfer would require local evaluation. [1]

Groundsource is an openly available historical dataset constructed from news reports. The research announcement describes roughly 2.6 million records across more than 150 countries. It is historical evidence for model development, not a live sensor stream or a standalone prediction API. The Zenodo record is the appropriate download entry point. [2][3]

Recommended use: subset events intersecting Indian catchments, retain the original record identifiers, deduplicate repeated reports, and keep spatial and temporal uncertainty. News-derived reporting coverage is an important potential source of bias. An unreported event should not automatically become a negative label. Split evaluation by both basin and time to reduce leakage. These are proposed research controls, not claims about completed processing.

Google's documented Flood Forecasting API provides riverine forecasts. Its access instructions specify waitlist approval, a Google Cloud project, an API key and service enablement. Public documentation calls the data no-charge under CC BY 4.0, but “no-charge” does not mean anonymous access. The API's riverine scope must not be presented as direct access to the urban flash-flood model. [4]

## WeatherNext 3 and open alternatives

The current Google developer documentation lists WeatherNext 3 as the operational model, with hourly initialization, 64 ensemble members and a 15-day horizon. Its outputs have multiple resolutions: station-calibrated surface products and regular grids should not be conflated. Resolution alone cannot establish rainfall accuracy in steep terrain. [5]

Operational forecast access is allowlisted. The current guide lists Google Cloud Storage, Earth Engine and BigQuery. It distinguishes real-time experimental terms from historical-data licensing. Request access and validate a real query before claiming the model is connected. [6]

Google explicitly states that WeatherNext 3 is not open source. The open-source guidance instead recommends WeatherNext 2 for research/self-hosted inference, alongside earlier Graph and Gen models for comparison. The code and other materials have different license terms. This resolves the important distinction between the latest operational service and an available open-source research model. [7]

Open-Meteo also documents a Google WeatherNext endpoint, but the inspected page names WeatherNext 2. Do not relabel that endpoint as WeatherNext 3. It is a possible low-friction comparator for a later integration, subject to provider availability and terms. [8]

ECMWF AIFS is an appropriate independent weather-model comparison candidate. ECMWF publishes deterministic and ensemble forecast data, with six-hour output steps to 15 days. Its open-data page describes a short rolling archive, so a research pipeline should persist forecast runs rather than assume arbitrary past runs remain online. AIFS should be compared alongside a physics-based forecast and local rainfall evidence; no reviewed source establishes it as second-best for this specific application. [9][10]

## Immediately usable weather integration

The prototype's server requests Open-Meteo current temperature and precipitation, hourly precipitation, and shallow volumetric soil moisture for two forecast days. Returned provenance and retrieval time are retained. A ten-minute cache reduces repeated requests. Source failures return an unavailable state; the interface never replaces missing observations with unlabeled invented values. The provider documentation lists parameters and units. [11]

This is model data, not a local observation network. Grid elevation and mountain microclimates can differ from the selected place. The UI intentionally leaves real weather separate from synthetic flood risk. A next-stage model must ingest forecast accumulation periods and initialization times consistently before deriving catchment features.

Open-Meteo's GloFAS-backed Flood API is another accessible contextual product. It documents daily discharge around a 5 km grid and warns that the chosen river may not be the intended one. It can support riverine context; daily discharge is not an hourly cloudburst warning or an inundation boundary. [12]

## Soil moisture as the research differentiator

NASA's SMAP Level-4 Version 8 product provides surface and root-zone soil moisture on a 9 km grid at three-hour intervals. It assimilates observations into a land model; it is not a dense field-sensor network. NSIDC identifies Version 8 as the most recent version on the inspected page and requires an Earthdata login for data access. Product quality flags and depth must be retained. [13]

The key proposed experiment is an ablation: compare the same baseline model with and without soil information, holding forecast run, terrain, train/test splits and event labels constant. Measure whether the extra feature improves calibration and useful warning lead time rather than just apparent separation in training data.

Volumetric moisture in m³/m³ and saturation fraction are not interchangeable. A site-specific conversion requires soil properties such as porosity; effective saturation additionally depends on the convention and residual water assumptions. The demo lab therefore uses clearly labeled assumed saturation. Its 0–100 score is deliberately an uncalibrated sensitivity index, not an AI probability. The comparison isolates the index's soil term, not a demonstrated scientific benefit.

Future physical sensors should provide measurement depth, calibration, device identity, location, battery/connectivity status and timestamps. Stale readings should remain stale. A virtual sensor stream should be isolated from live observations and visibly tagged. No physical sensors are connected in this version.

## Population, buildings, vegetation and terrain

The European Commission's GHSL catalog provides population and built-up products. These are suitable candidates for exposure analysis after checking edition, reference year and resolution. The UI's present population values are illustrative and do not come from GHSL. Population should influence impact estimates, not be treated as a direct source of runoff. Building surface and impervious cover can be useful explanatory variables, but they require hydrological interpretation. [14]

ESA WorldCover v200 offers a 10 m global land-cover product for 2021. It can support tree-cover and built-up classes, but its reference year must remain visible; it is not a live 2026 vegetation map. A production pipeline should evaluate newer suitable cover products or recent imagery where land change matters. [15]

The older Earth Engine Copernicus GLO-30 catalog entry is marked deprecated and points to `COPERNICUS/DEM/GLO30_2024_1`. It describes a digital surface model, which includes vegetation and structures. Hydrological processing should verify the current edition and perform appropriate conditioning before deriving channel routing. A rendered terrain mesh is not a hydrological solver. [16]

Proposed additional factors include drainage and channel capacity, road cuts, debris and landslide blockage, storm duration, snowmelt, glacial-lake outburst mechanisms, antecedent rainfall, and reservoir operations. These mechanisms should not be assumed captured merely by adding population and tree sliders. The current simulator deliberately omits them and documents that limitation.

## Map and interaction choice

The map layer was first built on CesiumJS 1.145 [17][18] and was replaced on 11 September 2026 by MapLibre GL JS 6.9.0, self-hosted under `public/vendor/` (BSD-3-Clause). MapLibre 6 provides a globe projection for the hero view, vector-tile rendering, raster-DEM terrain with hillshade and a strict content security policy without `unsafe-eval`. Basemaps are key-free: OpenFreeMap "Liberty" vector tiles built from OpenStreetMap/OpenMapTiles for the accurate 2D map, Esri World Imagery for the satellite view and AWS Terrain Tiles (Terrarium encoding; Mapzen, SRTM, Copernicus) for 3D relief. OpenStreetMap boundary rendering follows OSM conventions for disputed areas, which may differ from the Survey of India depiction; catchment polygons come from HydroBASINS regardless of basemap. [25][26][27]

Risk polygons use terrain classification and no artificial elevated slabs. Their displayed geographic shapes are synthetic; a production model should deliver validated catchment or inundation geometries. A smooth yellow-to-red transition conveys changing scenario intensity, while text labels retain categorical meaning. The viewport resolution is bounded for device performance rather than claiming every device renders at native 4K.

A green “candidate refuge” appears only on explicit request and is labeled unverified. It must not be used to direct evacuation. A real safest-area feature requires verified shelter data and hazard-aware accessibility; a nearest-point algorithm alone cannot establish safety.

## Implementation decision

Ship the frontend and weather adapter now, retain transparent source status, and perform backend work in stages. First add authoritative basin geometries and provenance. Then ingest weather and soil products. Train and validate the basin model before displaying probabilities. Add exposure and verified refuge data separately. Activate messaging only after advisory authority, consent, recipients and provider integration are established.

The implementation contains ten representative catchments. It is not an exhaustive national monitoring network. The research supports the integration direction; it does not substantiate a claim of operational warning capability, a globally best model, or improved accuracy from the illustrative soil index.

## Backend integration record (11 September 2026)

The sections above were written before the backend existed. This section records what was actually integrated, with the source editions used.

Catchment geometry now comes from HydroSHEDS HydroBASINS v1.c level 8 (Asia, 2014 release), a hydrologically derived sub-basin product built from 15 arc-second HydroSHEDS elevation data, and river topology from HydroRIVERS v1.0 (2019). Both are used under the HydroSHEDS licence with attribution. The level-8 unit containing each study seed point was selected; computed polygon areas agree with the product's `SUB_AREA` attribute to within 0.1%, which validates the shapefile parser. These are hydrological units, not districts and not inundation extents. [19][20]

Forecast runs are archived from the Open-Meteo distribution of ECMWF IFS 0.25° (native 3-hour steps, soil moisture in four layers 0–7, 7–28, 28–100 and 100–255 cm in m³/m³), ECMWF AIFS Single (6-hour steps, no soil) and the Google WeatherNext 2 ensemble (63 members). Open-Meteo publishes each model's last initialisation time, which the archive records as the issue time. ECMWF's own open-data GRIB feed was not used because parsing GRIB without dependencies was judged higher risk than archiving the provider's native-step distribution. [9][11]

GloFAS v4 daily discharge is requested at the downstream end of the largest HydroRIVERS reach inside each unit and is served strictly as riverine context. [12]

SMAP L4 Version 8 granule discovery works through NASA CMR without credentials (latest granule metadata is shown in the interface); retrieval of the ~140 MB HDF5 granules requires an Earthdata login token that was not available, so the ingestion script is unexecuted. [13]

Population exposure is computed with the WorldPop statistics API on the catchment polygon from the 2020 unconstrained 100 m product; the product publishes no per-polygon uncertainty, so uncertainty is reported as unknown rather than estimated. [21] Terrain statistics come from the Copernicus DEM GLO-90 2021 release as distributed by the Open-Meteo elevation API; the 2024 GLO-30 edition is named as the production target. [16]

Groundsource was downloaded from Zenodo (667,122,400 bytes; MD5 `cd1b5de6508f7aad8e1d1d0dd4cecea6` matches the record). Its schema is `uuid`, `area_km2`, `geometry` (WKB polygons, EPSG:4326), `start_date`, `end_date`; 448,378 of 2,646,302 events intersect the India bounding box. Intersection with the ten units produced 4,298 reports, deduplicated to 1,456 events, split into "local" (report footprint comparable to the unit and mostly inside it) and "regional" tiers. Local-tier event counts rise from single digits before 2010 to over a hundred per year after 2023, which is a reporting-coverage signal and a warning against reading later years as more hazardous. [3]

Historical features for training come from the NASA POWER daily point API: MERRA-2 bias-corrected precipitation and surface/root-zone soil wetness (dimensionless 0–1 model states, not m³/m³) at 0.5° resolution, 2005–2025. [24] An ERA5-Land route through the Open-Meteo historical API was attempted first but stalled on the provider's hourly request weights; the script is retained as an alternative. [22] Reanalysis stands in for forecasts, so any lead-time result is an upper bound. The baseline models and the soil ablation are described in `docs/MODEL_CARD.md`; because negatives are unlabeled, calibration is not attempted and flood probability stays null.

## Sources

1. Google Research. [Protecting cities with AI-driven flash flood forecasting](https://research.google/blog/protecting-cities-with-ai-driven-flash-flood-forecasting/). 12 March 2026.
2. Google Research. [Introducing Groundsource: Turning news reports into data with Gemini](https://www.research.google/blog/introducing-groundsource-turning-news-reports-into-data-with-gemini/). 12 March 2026.
3. Google Research / Zenodo. [Groundsource: A Dataset of Flood Events from News](https://zenodo.org/records/18647054). Dataset record inspected 11 September 2026.
4. Google for Developers. [Flood Forecasting API](https://developers.google.com/flood-forecasting). Page updated 12 January 2026.
5. Google for Developers. [WeatherNext](https://developers.google.com/weathernext). Current operational model overview, inspected 11 September 2026.
6. Google for Developers. [Quick start: Accessing WeatherNext forecasts](https://developers.google.com/weathernext/guides/access-forecast). Updated 3 September 2026.
7. Google for Developers. [Open source models](https://developers.google.com/weathernext/guides/osmodel). Updated 2 September 2026.
8. Open-Meteo. [Google WeatherNext 2 API](https://open-meteo.com/en/docs/google-weathernext-api). Inspected 11 September 2026.
9. ECMWF. [AIFS Machine Learning data](https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data). Inspected 11 September 2026.
10. ECMWF. [Open data](https://www.ecmwf.int/en/forecasts/datasets/open-data). Inspected 11 September 2026.
11. Open-Meteo. [Weather Forecast API documentation](https://open-meteo.com/en/docs). Inspected 11 September 2026.
12. Open-Meteo. [Global Flood API](https://open-meteo.com/en/docs/flood-api). Inspected 11 September 2026.
13. Reichle et al. / NASA NSIDC DAAC. [SMAP L4 surface and root-zone soil moisture, Version 8](https://nsidc.org/data/spl4smgp/versions/8). 2025 dataset edition, inspected 11 September 2026.
14. European Commission JRC. [Global Human Settlement Layer datasets](https://human-settlement.emergency.copernicus.eu/datasets.php). Inspected 11 September 2026.
15. Google Earth Engine / ESA. [ESA WorldCover 10m v200](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200). 2021 reference data.
16. Google Earth Engine / Copernicus. [GLO-30 catalog and supersession notice](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30). Inspected 11 September 2026.
17. Cesium. [Downloads and release history](https://cesium.com/downloads). CesiumJS 1.145, 1 September 2026.
18. Cesium. [Viewer API reference](https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html). Inspected 11 September 2026.
19. Lehner, B., Grill, G. (2013). Global river hydrography and network routing: baseline data and new approaches to study the world's large river systems. Hydrological Processes 27(15), 2171–2186. [HydroBASINS](https://www.hydrosheds.org/products/hydrobasins), file `hybas_as_lev08_v1c.zip` (34,308,015 bytes), downloaded 11 September 2026. Licence: https://www.hydrosheds.org/page/license.
20. HydroSHEDS. [HydroRIVERS v1.0](https://www.hydrosheds.org/products/hydrorivers), file `HydroRIVERS_v10_as_shp.zip` (90,510,995 bytes), downloaded 11 September 2026.
21. WorldPop (School of Geography and Environmental Science, University of Southampton). [WorldPop REST API and 2020 unconstrained population count, 100 m](https://www.worldpop.org/rest-data/). DOI 10.5258/SOTON/WP00647. Used 11 September 2026.
22. Muñoz Sabater, J. (2019). ERA5-Land hourly data from 1950 to present. Copernicus Climate Change Service (C3S) Climate Data Store, DOI 10.24381/cds.e2161bac, via the [Open-Meteo historical weather API](https://open-meteo.com/en/docs/historical-weather-api). Used 11 September 2026.
23. NASA Earthdata. [Common Metadata Repository search API](https://cmr.earthdata.nasa.gov/search/) for SPL4SMGP version 008 granules. Used 11 September 2026.
24. NASA Langley Research Center. [POWER Project daily point API v2.9.7](https://power.larc.nasa.gov/docs/services/api/temporal/daily/), parameters PRECTOTCORR, GWETTOP, GWETROOT (MERRA-2). Used 11 September 2026.
25. MapLibre. [MapLibre GL JS 6.9.0](https://github.com/maplibre/maplibre-gl-js/releases), BSD-3-Clause; vendored from npm on 11 September 2026.
26. OpenFreeMap. [Liberty style and vector tiles](https://openfreemap.org) (OpenMapTiles schema, © OpenStreetMap contributors). Used 11 September 2026.
27. AWS Open Data. [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium encoding; SRTM, Copernicus and other DEM sources). Used 11 September 2026.
