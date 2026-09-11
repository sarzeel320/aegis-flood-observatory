#!/usr/bin/env node
// Scheduled ingestion: archive the current forecast run of every model for every catchment, plus GloFAS discharge.
// Run from cron/systemd on the providers' publication cadence, e.g. every 3 hours:
//   0 */3 * * *  cd /srv/aegis && node scripts/archive-forecasts.mjs >> logs/ingest.log 2>&1
// Runs that are already archived for the provider's current initialisation time are not re-fetched.
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { createLogger } from '../lib/log.mjs';
import { createApp } from '../lib/app.mjs';
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const root = fileURLToPath(new URL('..', import.meta.url));
const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, service: 'aegis-ingest' });
const app = createApp({ config, root, logger });
const models = Object.values(app.providers.openMeteo.models);
let ok = 0, failed = 0;
for (const id of app.catchments.ids()) {
  const catchment = app.catchments.get(id);
  for (const model of models) {
    try { const run = await app.providers.openMeteo.latestRun(catchment, model); ok++; logger.info('archived', { catchment: id, model: model.id, issuedAt: run.issuedAt, fromArchive: run.fromArchive, stale: Boolean(run.stale) }); }
    catch (error) { failed++; logger.error('archive failed', { catchment: id, model: model.id, error }); }
  }
  try { await app.providers.glofas.discharge(catchment); } catch (error) { logger.warn('glofas failed', { catchment: id, error }); }
}
app.store.audit.record({ actor: 'scheduler', action: 'ingest.forecasts', subjectType: 'forecast_runs', details: { ok, failed } });
logger.info('ingest complete', { ok, failed, archivedRuns: app.store.forecastRuns.count() });
app.close();
process.exit(failed && !ok ? 1 : 0);
