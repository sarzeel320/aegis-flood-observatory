// AEGIS server entry point. Loads validated configuration, builds the application and listens on loopback by default.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError, describeConfig } from './lib/config.mjs';
import { createLogger } from './lib/log.mjs';
import { createApp } from './lib/app.mjs';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const root = fileURLToPath(new URL('./', import.meta.url));
let config;
try { config = loadConfig(); } catch (error) { if (error instanceof ConfigError) { console.error(`Configuration error: ${error.message}`); process.exit(1); } throw error; }
const logger = createLogger({ level: config.LOG_LEVEL });
const app = createApp({ config, root, logger });
const server = http.createServer((req, res) => { app.handle(req, res).catch(error => { logger.error('unhandled', { error }); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Internal error"}'); } }); });
server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 100;
server.listen(config.PORT, config.HOST, () => {
  logger.info('AEGIS ready', { url: `http://${config.HOST}:${server.address().port}`, config: describeConfig(config) });
  console.log(`AEGIS ready at http://${config.HOST}:${server.address().port}`);
});
const shutdown = signal => { logger.info('shutdown', { signal }); server.close(() => { app.close(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); };
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
