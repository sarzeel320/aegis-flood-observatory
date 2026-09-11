// Google WeatherNext access status. WeatherNext 3 is an allow-listed operational service (not open source) reached
// through Google Cloud Storage, BigQuery or Earth Engine after approval. This adapter reports the configured access
// path and never substitutes WeatherNext 2 for it. The WeatherNext 2 ensemble is served separately by openmeteo.mjs.
export function weatherNextStatus(config) {
  const configured = config.WEATHERNEXT_ACCESS_MODE !== 'none' && Boolean(config.WEATHERNEXT_PROJECT) && Boolean(config.GOOGLE_APPLICATION_CREDENTIALS);
  return {
    weatherNext3: { name: 'Google WeatherNext 3', status: configured ? 'configured-untested' : 'not-configured', accessMode: config.WEATHERNEXT_ACCESS_MODE, project: config.WEATHERNEXT_PROJECT ? 'configured' : 'not configured', note: 'Operational, allow-listed service. Request access at https://developers.google.com/weathernext/guides/access-forecast. No WeatherNext 3 query has been executed by this service; do not label any output as WeatherNext 3 until an actual run is archived.', integration: configured ? 'Adapter stub: implement lib/providers/weathernext3.mjs against the approved bucket/table after validating a real query.' : null },
    weatherNext2: { name: 'Google WeatherNext 2 ensemble (open research model)', status: 'available-via-open-meteo', model: 'google_weathernext2_ensemble', note: 'Context model only. Labeled WeatherNext 2, never WeatherNext 3.' }
  };
}
