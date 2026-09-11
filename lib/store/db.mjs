// Persistent store on SQLite (node:sqlite, built into Node ≥22.13). Holds the cache, archived forecast runs,
// scenarios, subscriptions, advisories, delivery queue, idempotency keys and audit log.
// A PostGIS schema for the geospatial tables is provided in lib/store/postgis.sql; this module keeps the same
// logical tables so the service can be pointed at PostGIS later without changing the API layer.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const migrations = [
  `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, saved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS cache_expires ON cache(expires_at);
   CREATE TABLE IF NOT EXISTS forecast_runs (id TEXT PRIMARY KEY, catchment_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, issued_at TEXT, retrieved_at TEXT NOT NULL, valid_from TEXT, valid_to TEXT, native_resolution TEXT, step_seconds INTEGER, license TEXT, payload TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS forecast_runs_lookup ON forecast_runs(catchment_id, model, issued_at);
   CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, namespace TEXT NOT NULL, catchment_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, channel TEXT NOT NULL, address TEXT NOT NULL, address_hash TEXT NOT NULL, language TEXT NOT NULL, catchment_id TEXT NOT NULL, status TEXT NOT NULL, consent_text_version TEXT NOT NULL, consent_recorded_at TEXT NOT NULL, verification_code_hash TEXT, verification_expires_at TEXT, verified_at TEXT, unsubscribed_at TEXT, unsubscribe_token TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_unique ON subscriptions(channel, address_hash, catchment_id);
   CREATE TABLE IF NOT EXISTS advisories (id TEXT PRIMARY KEY, catchment_id TEXT NOT NULL, status TEXT NOT NULL, authority TEXT NOT NULL, template_id TEXT NOT NULL, template_version TEXT NOT NULL, issued_at TEXT, expires_at TEXT, affected_area TEXT NOT NULL, recommended_action TEXT NOT NULL, official_link TEXT NOT NULL, supersedes TEXT, approved_by TEXT, approved_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, advisory_id TEXT NOT NULL, subscription_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, provider TEXT, provider_message_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, route TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT, request_id TEXT, details TEXT);
   CREATE TABLE IF NOT EXISTS model_releases (version TEXT PRIMARY KEY, released_at TEXT NOT NULL, status TEXT NOT NULL, card_path TEXT, metrics_path TEXT, notes TEXT);`
];
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const sql of migrations) db.exec(sql);
  const now = () => new Date().toISOString();
  const stmt = new Map();
  const prepare = sql => { if (!stmt.has(sql)) stmt.set(sql, db.prepare(sql)); return stmt.get(sql); };
  const store = {
    db,
    close: () => db.close(),
    cache: {
      get(key) { const row = prepare('SELECT value, saved_at, expires_at FROM cache WHERE key = ?').get(key); if (!row) return null; if (row.expires_at <= Date.now()) return null; /* expired rows stay for getStale() until purge() */ return { value: JSON.parse(row.value), savedAt: new Date(Number(row.saved_at)).toISOString(), stale: false }; },
      getStale(key) { const row = prepare('SELECT value, saved_at, expires_at FROM cache WHERE key = ?').get(key); return row ? { value: JSON.parse(row.value), savedAt: new Date(Number(row.saved_at)).toISOString(), stale: row.expires_at <= Date.now() } : null; },
      set(key, value, ttlSeconds) { prepare('INSERT OR REPLACE INTO cache(key, value, saved_at, expires_at) VALUES (?, ?, ?, ?)').run(key, JSON.stringify(value), Date.now(), Date.now() + ttlSeconds * 1000); },
      purge(maxRows = 5000) { prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now() - 7 * 86400000); const n = prepare('SELECT COUNT(*) AS n FROM cache').get().n; if (n > maxRows) prepare('DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY saved_at ASC LIMIT ?)').run(n - maxRows); }
    },
    forecastRuns: {
      save(run) { const id = run.id || randomUUID(); prepare('INSERT OR REPLACE INTO forecast_runs(id, catchment_id, provider, model, issued_at, retrieved_at, valid_from, valid_to, native_resolution, step_seconds, license, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, run.catchmentId, run.provider, run.model, run.issuedAt ?? null, run.retrievedAt || now(), run.validFrom ?? null, run.validTo ?? null, run.nativeResolution ?? null, run.stepSeconds ?? null, run.license ?? null, JSON.stringify(run.payload)); return id; },
      latest(catchmentId, model) { const row = prepare('SELECT * FROM forecast_runs WHERE catchment_id = ? AND model = ? ORDER BY issued_at DESC, retrieved_at DESC LIMIT 1').get(catchmentId, model); return row ? { ...row, payload: JSON.parse(row.payload) } : null; },
      list(catchmentId, limit = 20) { return prepare('SELECT id, catchment_id, provider, model, issued_at, retrieved_at, valid_from, valid_to, native_resolution, step_seconds, license FROM forecast_runs WHERE catchment_id = ? ORDER BY retrieved_at DESC LIMIT ?').all(catchmentId, limit); },
      count() { return prepare('SELECT COUNT(*) AS n FROM forecast_runs').get().n; }
    },
    scenarios: {
      create(s) { const id = `scenario_${randomUUID()}`; prepare('INSERT INTO scenarios(id, namespace, catchment_id, name, created_at, created_by, payload) VALUES (?,?,?,?,?,?,?)').run(id, s.namespace, s.catchmentId, s.name, now(), s.createdBy ?? null, JSON.stringify(s.payload)); return store.scenarios.get(id); },
      get(id) { const row = prepare('SELECT * FROM scenarios WHERE id = ?').get(id); return row ? { id: row.id, namespace: row.namespace, catchmentId: row.catchment_id, name: row.name, createdAt: row.created_at, createdBy: row.created_by, ...JSON.parse(row.payload) } : null; },
      list(catchmentId, limit = 50) { return prepare('SELECT id, namespace, catchment_id, name, created_at FROM scenarios WHERE (? IS NULL OR catchment_id = ?) ORDER BY created_at DESC LIMIT ?').all(catchmentId ?? null, catchmentId ?? null, limit).map(r => ({ id: r.id, namespace: r.namespace, catchmentId: r.catchment_id, name: r.name, createdAt: r.created_at })); }
    },
    subscriptions: {
      create(s) { const id = `sub_${randomUUID()}`; prepare('INSERT INTO subscriptions(id, channel, address, address_hash, language, catchment_id, status, consent_text_version, consent_recorded_at, verification_code_hash, verification_expires_at, unsubscribe_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, s.channel, s.address, s.addressHash, s.language, s.catchmentId, s.status, s.consentTextVersion, now(), s.verificationCodeHash, s.verificationExpiresAt, s.unsubscribeToken, now()); return store.subscriptions.get(id); },
      get(id) { return prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) ?? null; },
      findByHash(channel, addressHash, catchmentId) { return prepare('SELECT * FROM subscriptions WHERE channel = ? AND address_hash = ? AND catchment_id = ?').get(channel, addressHash, catchmentId) ?? null; },
      findByToken(token) { return prepare('SELECT * FROM subscriptions WHERE unsubscribe_token = ?').get(token) ?? null; },
      verify(id) { prepare("UPDATE subscriptions SET status = 'active', verified_at = ?, verification_code_hash = NULL WHERE id = ?").run(now(), id); },
      unsubscribe(id) { prepare("UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").run(now(), id); },
      active(catchmentId, language) { return prepare("SELECT * FROM subscriptions WHERE catchment_id = ? AND status = 'active' AND (? IS NULL OR language = ?)").all(catchmentId, language ?? null, language ?? null); },
      counts() { return prepare('SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status').all(); }
    },
    advisories: {
      create(a) { const id = `adv_${randomUUID()}`; prepare('INSERT INTO advisories(id, catchment_id, status, authority, template_id, template_version, issued_at, expires_at, affected_area, recommended_action, official_link, supersedes, created_at, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, a.catchmentId, 'draft', a.authority, a.templateId, a.templateVersion, a.issuedAt ?? null, a.expiresAt ?? null, a.affectedArea, a.recommendedAction, a.officialLink, a.supersedes ?? null, now(), JSON.stringify(a.payload ?? {})); return store.advisories.get(id); },
      get(id) { const row = prepare('SELECT * FROM advisories WHERE id = ?').get(id); return row ? { ...row, payload: JSON.parse(row.payload) } : null; },
      setStatus(id, status, fields = {}) { const sets = ['status = ?']; const values = [status]; for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); } values.push(id); prepare(`UPDATE advisories SET ${sets.join(', ')} WHERE id = ?`).run(...values); },
      list(catchmentId, limit = 50) { return prepare('SELECT id, catchment_id, status, authority, template_id, template_version, issued_at, expires_at, created_at, approved_at, cancelled_at, supersedes FROM advisories WHERE (? IS NULL OR catchment_id = ?) ORDER BY created_at DESC LIMIT ?').all(catchmentId ?? null, catchmentId ?? null, limit); }
    },
    deliveries: {
      enqueue(d) { const id = `dlv_${randomUUID()}`; try { prepare('INSERT INTO deliveries(id, advisory_id, subscription_id, idempotency_key, status, provider, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, d.advisoryId, d.subscriptionId, d.idempotencyKey, d.status, d.provider ?? null, now(), now()); return { id, created: true }; } catch (error) { if (String(error.message).includes('UNIQUE')) return { id: prepare('SELECT id FROM deliveries WHERE idempotency_key = ?').get(d.idempotencyKey).id, created: false }; throw error; } },
      listForAdvisory(advisoryId) { return prepare('SELECT id, subscription_id, status, provider, provider_message_id, attempts, last_error, created_at, updated_at FROM deliveries WHERE advisory_id = ?').all(advisoryId); },
      update(id, fields) { const sets = ['updated_at = ?']; const values = [now()]; for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); values.push(v); } values.push(id); prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...values); },
      counts() { return prepare('SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status').all(); }
    },
    idempotency: {
      get(key) { const row = prepare('SELECT * FROM idempotency WHERE key = ?').get(key); return row ? { ...row, response: JSON.parse(row.response) } : null; },
      set(key, route, requestHash, status, response) { prepare('INSERT OR IGNORE INTO idempotency(key, route, request_hash, status, response, created_at) VALUES (?,?,?,?,?,?)').run(key, route, requestHash, status, JSON.stringify(response), now()); }
    },
    audit: {
      record(entry) { prepare('INSERT INTO audit_log(at, actor, action, subject_type, subject_id, request_id, details) VALUES (?,?,?,?,?,?,?)').run(now(), entry.actor ?? null, entry.action, entry.subjectType, entry.subjectId ?? null, entry.requestId ?? null, entry.details ? JSON.stringify(entry.details) : null); },
      list(limit = 100) { return prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null })); }
    },
    modelReleases: {
      upsert(r) { prepare('INSERT OR REPLACE INTO model_releases(version, released_at, status, card_path, metrics_path, notes) VALUES (?,?,?,?,?,?)').run(r.version, r.releasedAt || now(), r.status, r.cardPath ?? null, r.metricsPath ?? null, r.notes ?? null); },
      list() { return prepare('SELECT * FROM model_releases ORDER BY released_at DESC').all(); }
    }
  };
  return store;
}
