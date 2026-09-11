// Typed configuration loaded from environment variables and validated at startup.
// Secrets are marked so they are never echoed by logs, health routes or error messages.
const schema = {
  PORT: { type: 'int', default: 4173, min: 1, max: 65535 },
  HOST: { type: 'string', default: '127.0.0.1', pattern: /^[a-z0-9.:-]+$/i },
  NODE_ENV: { type: 'enum', values: ['development', 'test', 'production'], default: 'development' },
  LOG_LEVEL: { type: 'enum', values: ['debug', 'info', 'warn', 'error'], default: 'info' },
  AEGIS_DB_PATH: { type: 'string', default: 'data/aegis.sqlite' },
  ALLOWED_ORIGINS: { type: 'list', default: [] },
  RATE_LIMIT_PER_MINUTE: { type: 'int', default: 120, min: 1, max: 100000 },
  OUTBOUND_TIMEOUT_MS: { type: 'int', default: 12000, min: 1000, max: 120000 },
  OUTBOUND_MAX_BYTES: { type: 'int', default: 8 * 1024 * 1024, min: 1024, max: 256 * 1024 * 1024 },
  CACHE_TTL_SECONDS: { type: 'int', default: 600, min: 0, max: 86400 },
  REQUEST_BODY_MAX_BYTES: { type: 'int', default: 64 * 1024, min: 1024, max: 4 * 1024 * 1024 },
  EARTHDATA_TOKEN: { type: 'string', default: '', secret: true },
  WEATHERNEXT_ACCESS_MODE: { type: 'enum', values: ['none', 'gcs', 'bigquery', 'earth-engine'], default: 'none' },
  WEATHERNEXT_PROJECT: { type: 'string', default: '' },
  GOOGLE_APPLICATION_CREDENTIALS: { type: 'string', default: '', secret: true },
  NOTIFICATION_PROVIDER: { type: 'enum', values: ['none', 'dry-run'], default: 'none' },
  NOTIFICATION_SENDS_ENABLED: { type: 'bool', default: false },
  ADVISORY_AUTHORITY_KEY: { type: 'string', default: '', secret: true },
  ADMIN_API_KEY: { type: 'string', default: '', secret: true },
  TRUST_PROXY: { type: 'bool', default: false }
};
export class ConfigError extends Error {}
function parse(name, spec, raw) {
  if (raw === undefined || raw === '') return spec.default;
  switch (spec.type) {
    case 'int': { const n = Number(raw); if (!Number.isInteger(n) || n < spec.min || n > spec.max) throw new ConfigError(`${name} must be an integer between ${spec.min} and ${spec.max}`); return n; }
    case 'bool': if (!/^(true|false|1|0)$/i.test(raw)) throw new ConfigError(`${name} must be true or false`); return /^(true|1)$/i.test(raw);
    case 'enum': if (!spec.values.includes(raw)) throw new ConfigError(`${name} must be one of ${spec.values.join(', ')}`); return raw;
    case 'list': return raw.split(',').map(s => s.trim()).filter(Boolean);
    default: if (spec.pattern && !spec.pattern.test(raw)) throw new ConfigError(`${name} has an invalid value`); return raw;
  }
}
export function loadConfig(env = process.env) {
  const config = {};
  for (const [name, spec] of Object.entries(schema)) config[name] = parse(name, spec, env[name]);
  if (config.NOTIFICATION_SENDS_ENABLED && config.NOTIFICATION_PROVIDER === 'none') throw new ConfigError('NOTIFICATION_SENDS_ENABLED requires a configured NOTIFICATION_PROVIDER');
  for (const origin of config.ALLOWED_ORIGINS) if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new ConfigError(`ALLOWED_ORIGINS entry is not an origin: ${origin}`);
  return Object.freeze(config);
}
export const secretNames = Object.entries(schema).filter(([, s]) => s.secret).map(([n]) => n);
// Safe description of configuration for health/readiness output: presence only, never values.
export function describeConfig(config) {
  return Object.fromEntries(Object.entries(schema).map(([name, spec]) => [name, spec.secret ? (config[name] ? 'configured' : 'not configured') : config[name]]));
}
