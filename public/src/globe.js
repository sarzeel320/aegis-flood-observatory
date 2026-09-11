// Map layer on MapLibre GL JS 6.9.0 (self-hosted in /vendor/maplibre-gl, BSD-3-Clause).
// Basemaps (all key-free): OpenFreeMap "Liberty" vector tiles (OpenStreetMap data) for the accurate street/terrain
// map, Esri World Imagery for satellite view, and AWS Terrain Tiles (Terrarium) for 3D terrain and hillshade.
// Catchment geometry comes from /api/v1/catchments (HydroBASINS); colouring is the demonstration index only.
import { regions, riskIndex, riskColor } from './model.js';
import { loadCatchments, loadRivers } from './catalog.js';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const IMAGERY = { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 17, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community' };
const DEM = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain © <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (Mapzen, SRTM, Copernicus)' };
const INDIA = { center: [81.5, 24.5], zoom: 4.1 };
let maplibregl, hero, map, mode = '3D', filter = 'All', currentHour = 0, selectedId = regions[0].id, boundaries = null, pendingFocus = false, ready = false;
const overrides = new Map(), riverLoaded = new Set();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let selectionCallback = () => {};
function failure(id, message) { const target = document.getElementById(id); target.replaceChildren(); const p = document.createElement('div'); p.className = 'map-loading'; p.textContent = message; target.append(p); }
function notice(text) { document.getElementById('map-notice').textContent = text; }
async function loadLibrary() { if (maplibregl) return maplibregl; const mod = await import('/vendor/maplibre-gl/maplibre-gl.mjs'); maplibregl = mod.default ?? mod; return maplibregl; }
export async function initGlobes(onSelect) {
  selectionCallback = onSelect;
  try { await loadLibrary(); } catch { failure('hero-globe', 'The map library could not load. Reload the page.'); failure('risk-map', 'Map unavailable. Region controls, watchlist, and soil lab remain available.'); return; }
  try {
    document.getElementById('hero-globe').replaceChildren();
    hero = new maplibregl.Map({ container: 'hero-globe', style: { version: 8, sources: { imagery: IMAGERY }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b1212' } }, { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': .82, 'raster-saturation': -.35, 'raster-contrast': .12 } }] }, center: [84, 20], zoom: 1.35, interactive: false, attributionControl: { compact: true } });
    hero.on('load', () => { try { hero.setProjection({ type: 'globe' }); } catch { /* globe projection unavailable: flat fallback */ } });
    const marker = document.createElement('div'); marker.className = 'hero-marker'; new maplibregl.Marker({ element: marker }).setLngLat([79.0669, 30.7352]).addTo(hero);
    let queued = false;
    const update = () => { queued = false; if (!hero || reduced) return; const range = document.querySelector('.hero-scroll').offsetHeight - innerHeight; const p = Math.max(0, Math.min(1, scrollY / Math.max(range, 1))); const eased = p * p * (3 - 2 * p); hero.jumpTo({ center: [84 - 5 * eased, 20 + 9 * eased], zoom: 1.35 + 3.1 * eased }); document.querySelector('.hero-copy').style.opacity = String(1 - p * .85); document.querySelector('.hero-copy').style.transform = `translateY(${-p * 45}px)`; };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true }); update();
  } catch { failure('hero-globe', 'Globe rendering is unavailable on this device. Explore the catchment data below.'); }
  // Lazy-load the regional map when it approaches the viewport; fall back to a timer where IntersectionObserver
  // does not fire (hidden or embedded surfaces).
  let started = false; const start = () => { if (started) return; started = true; observer.disconnect(); initializeMap(); };
  const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) start(); }, { rootMargin: '350px' }); observer.observe(document.getElementById('risk-map'));
  setTimeout(start, 4000);
}
function catchmentCollection() { return { type: 'FeatureCollection', features: boundaries.features.map(f => ({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, name: f.properties.name, group: f.properties.group } })) }; }
function pointCollection() { return { type: 'FeatureCollection', features: regions.map(r => { const f = boundaries?.features.find(x => x.id === r.id); return { type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: f ? f.properties.seedPoint : [r.lon, r.lat] }, properties: { id: r.id, name: r.name, group: r.group } }; }) }; }
async function initializeMap() {
  try {
    document.getElementById('risk-map').replaceChildren();
    try { boundaries = await loadCatchments(); } catch { boundaries = null; }
    map = new maplibregl.Map({ container: 'risk-map', style: STYLE_URL, center: INDIA.center, zoom: INDIA.zoom, minZoom: 2.5, maxZoom: 15, scrollZoom: false, attributionControl: { compact: true }, maxPitch: 70 });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    map.on('error', e => { if (/tiles\.openfreemap|arcgisonline|amazonaws/.test(String(e?.error?.message || e?.error?.url || ''))) notice('Some map tiles are unavailable · catchment data remains usable'); });
    await new Promise((resolve, reject) => { map.once('load', resolve); map.once('error', reject); setTimeout(() => reject(new Error('style timeout')), 20000); });
    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    map.addSource('imagery', IMAGERY); map.addSource('dem', DEM);
    map.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' }, paint: { 'raster-brightness-max': .85, 'raster-saturation': -.3, 'raster-contrast': .1 } }, firstSymbol);
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': .35, 'hillshade-shadow-color': '#0b1212' } }, firstSymbol);
    if (boundaries) {
      map.addSource('catchments', { type: 'geojson', data: catchmentCollection(), promoteId: 'id' });
      map.addLayer({ id: 'catchment-fill', type: 'fill', source: 'catchments', paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], '#efc36e'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'filled'], false], .42, 0], 'fill-color-transition': { duration: reduced ? 0 : 550 }, 'fill-opacity-transition': { duration: reduced ? 0 : 350 } } }, firstSymbol);
      map.addLayer({ id: 'catchment-outline', type: 'line', source: 'catchments', paint: { 'line-color': '#e9eadb', 'line-width': 1.6, 'line-opacity': ['case', ['boolean', ['feature-state', 'visible'], true], .7, 0] } }, firstSymbol);
      map.on('click', 'catchment-fill', e => { const id = e.features?.[0]?.properties?.id; if (id && regions.some(r => r.id === id)) selectionCallback(id); });
      map.on('mouseenter', 'catchment-fill', () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', 'catchment-fill', () => { map.getCanvas().style.cursor = ''; });
    }
    map.addSource('points', { type: 'geojson', data: pointCollection(), promoteId: 'id' });
    map.addLayer({ id: 'catchment-points', type: 'circle', source: 'points', paint: { 'circle-radius': 5, 'circle-color': ['coalesce', ['feature-state', 'color'], '#efc36e'], 'circle-stroke-color': '#17231b', 'circle-stroke-width': 2, 'circle-opacity': ['case', ['boolean', ['feature-state', 'visible'], true], 1, 0], 'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'visible'], true], 1, 0] } });
    map.addLayer({ id: 'catchment-labels', type: 'symbol', source: 'points', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#e9eadb', 'text-halo-color': '#101817', 'text-halo-width': 1.5, 'text-opacity': ['case', ['boolean', ['feature-state', 'visible'], true], 1, 0] } });
    map.on('click', 'catchment-points', e => { const id = e.features?.[0]?.properties?.id; if (id) selectionCallback(id); });
    ready = true;
    notice(boundaries ? `OpenFreeMap (OpenStreetMap) vector map · HydroBASINS ${boundaries.edition} boundaries · demonstration index colouring` : 'OpenFreeMap vector map · catchment boundaries unavailable, study points only');
    applyMode();
    if (pendingFocus) focusRegion(selectedId); else resetMap();
    updateMap(currentHour, filter);
  } catch (error) { map?.remove?.(); map = undefined; ready = false; failure('risk-map', 'WebGL map unavailable. Select a region using the panel or watchlist.'); }
}
async function showRivers(id) {
  if (!ready || riverLoaded.has(id)) return; riverLoaded.add(id);
  try {
    const rivers = await loadRivers(id); if (!map) return;
    const data = { type: 'FeatureCollection', features: rivers.features.filter(r => (r.properties.strahlerOrder ?? 0) >= 3).map(r => ({ type: 'Feature', geometry: r.geometry, properties: { order: r.properties.strahlerOrder, hyrivId: r.properties.hyrivId } })) };
    map.addSource(`rivers-${id}`, { type: 'geojson', data });
    map.addLayer({ id: `rivers-${id}`, type: 'line', source: `rivers-${id}`, paint: { 'line-color': '#82b8cc', 'line-opacity': .8, 'line-width': ['interpolate', ['linear'], ['get', 'order'], 3, 1, 6, 3] } }, 'catchment-points');
  } catch { riverLoaded.delete(id); }
}
function applyMode() {
  if (!ready) return;
  const satellite = mode === '3D';
  map.setLayoutProperty('imagery', 'visibility', satellite ? 'visible' : 'none');
  map.setLayoutProperty('hillshade', 'visibility', satellite ? 'visible' : 'none');
  if (satellite) { map.setTerrain({ source: 'dem', exaggeration: 1.25 }); map.easeTo({ pitch: 55, duration: reduced ? 0 : 900 }); }
  else { map.setTerrain(null); map.easeTo({ pitch: 0, bearing: 0, duration: reduced ? 0 : 900 }); }
  notice(satellite ? `Esri imagery · AWS terrain tiles (3D) · HydroBASINS ${boundaries?.edition ?? ''} boundaries draped on terrain` : `OpenFreeMap (OpenStreetMap) vector map · HydroBASINS ${boundaries?.edition ?? ''} boundaries · demonstration index colouring`);
}
export function setMode(next) { mode = next; applyMode(); }
export function resetMap() { if (!ready) return; map.flyTo({ center: INDIA.center, zoom: INDIA.zoom, pitch: mode === '3D' ? 35 : 0, bearing: 0, duration: reduced ? 0 : 1200 }); }
export function zoomMap(direction) { if (!ready) return; if (direction > 0) map.zoomIn({ duration: reduced ? 0 : 300 }); else map.zoomOut({ duration: reduced ? 0 : 300 }); }
export function focusRegion(id, fly = true) {
  selectedId = id; if (fly) pendingFocus = true; if (!ready || !fly) return;
  showRivers(id);
  const feature = boundaries?.features.find(f => f.id === id); const region = regions.find(r => r.id === id);
  if (feature) { const [w, s, e, n] = feature.bbox; map.fitBounds([[w, s], [e, n]], { padding: 60, pitch: mode === '3D' ? 55 : 0, bearing: 0, duration: reduced ? 0 : 1600, maxZoom: 11 }); }
  else map.flyTo({ center: [region.lon, region.lat], zoom: 9.5, pitch: mode === '3D' ? 55 : 0, duration: reduced ? 0 : 1600 });
}
export function setOverride(id, params) { overrides.set(id, params); updateMap(currentHour, filter); }
export function updateMap(hour, group) {
  currentHour = hour; filter = group; if (!ready) return;
  for (const region of regions) {
    const score = riskIndex(overrides.get(region.id) || region, hour);
    const inGroup = group === 'All' || region.group === group, filled = inGroup && score >= 40;
    const color = riskColor(score);
    if (boundaries && map.getSource('catchments')) map.setFeatureState({ source: 'catchments', id: region.id }, { color, filled, visible: inGroup });
    map.setFeatureState({ source: 'points', id: region.id }, { color, visible: inGroup });
  }
}
