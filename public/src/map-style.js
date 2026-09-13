export async function loadBaseStyle(url, fetchImpl = fetch, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Basemap HTTP ${response.status}`);
    const style = await response.json();
    if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error('Invalid basemap style');
    return { style, fallback: false };
  } catch {
    // A local style lets the map start even if the vector basemap service is offline.
    return { fallback: true, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#152624' } }] } };
  } finally { clearTimeout(timer); }
}

export function waitForStyle(map, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const loaded = () => { clearTimeout(timer); map.off('style.load', loaded); resolve(); };
    const timer = setTimeout(() => { map.off('style.load', loaded); reject(new Error('Map style did not initialize')); }, timeoutMs);
    // Individual tile/font errors are recoverable and must not destroy the map.
    map.on('style.load', loaded);
    if (map.isStyleLoaded()) loaded();
  });
}
