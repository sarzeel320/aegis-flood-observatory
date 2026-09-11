// Minimal HTTP framework: routing with path params, request IDs, structured access logs, rate limiting,
// CORS/CSP headers, bounded JSON bodies, and uniform error responses.
import { randomUUID, createHash } from 'node:crypto';
export class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
export function createRateLimiter({ perMinute = 120, now = Date.now } = {}) {
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) { b = { tokens: perMinute, at: t }; buckets.set(key, b); }
      b.tokens = Math.min(perMinute, b.tokens + (t - b.at) / 60000 * perMinute); b.at = t;
      if (b.tokens < 1) return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / perMinute * 60) };
      b.tokens -= 1; return { ok: true };
    },
    sweep() { const cutoff = now() - 600000; for (const [k, b] of buckets) if (b.at < cutoff) buckets.delete(k); }
  };
}
export async function readJsonBody(req, maxBytes) {
  const type = req.headers['content-type'] || '';
  if (!/^application\/json\b/.test(type)) throw new HttpError(415, 'Content-Type must be application/json');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'Request body too large');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new HttpError(413, 'Request body too large'); chunks.push(chunk); }
  if (size === 0) throw new HttpError(400, 'Request body is required');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON'); }
}
export const hashBody = body => createHash('sha256').update(JSON.stringify(body)).digest('hex');
export function createRouter({ logger, config, rateLimiter }) {
  const routes = [];
  const add = (method, pattern, handler, options = {}) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([A-Za-z0-9_.:@+-]{1,120})'; }) + '/?$');
    routes.push({ method, regex, keys, handler, options });
  };
  const api = { get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o), delete: (p, h, o) => add('DELETE', p, h, o), routes };
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://tiles.openfreemap.org https://services.arcgisonline.com https://server.arcgisonline.com https://s3.amazonaws.com; connect-src 'self' https://tiles.openfreemap.org https://services.arcgisonline.com https://server.arcgisonline.com https://s3.amazonaws.com; worker-src 'self' blob:; child-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  api.handle = async function handle(req, res, fallback) {
    const started = process.hrtime.bigint();
    const requestId = /^[A-Za-z0-9-]{8,64}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');
    if (!isApi) res.setHeader('Content-Security-Policy', csp);
    const origin = req.headers.origin;
    if (origin && config.ALLOWED_ORIGINS.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Request-Id, Authorization'); res.setHeader('Access-Control-Max-Age', '600'); }
    const ip = (config.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    const log = logger.child({ requestId, method: req.method, path: url.pathname });
    const finish = (status) => { const ms = Number(process.hrtime.bigint() - started) / 1e6; log.info('request', { status, ms: Math.round(ms * 10) / 10, ip: config.NODE_ENV === 'production' ? undefined : ip }); };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(origin && config.ALLOWED_ORIGINS.includes(origin) ? 204 : 403); res.end(); return finish(res.statusCode); }
      if (isApi) {
        const limit = rateLimiter.take(ip);
        if (!limit.ok) { json(res, 429, { error: 'Too many requests', requestId }, { 'Retry-After': String(limit.retryAfter) }); return finish(429); }
      }
      for (const route of routes) {
        const match = route.regex.exec(url.pathname);
        if (!match || route.method !== req.method) continue;
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
        const ctx = { req, res, url, params, query: url.searchParams, requestId, log, ip, body: undefined };
        if (req.method === 'POST') ctx.body = await readJsonBody(req, config.REQUEST_BODY_MAX_BYTES);
        const result = await route.handler(ctx);
        if (result !== undefined && !res.writableEnded) json(res, result.status || 200, result.body ?? result, result.headers);
        return finish(res.statusCode);
      }
      if (routes.some(r => r.regex.test(url.pathname))) { json(res, 405, { error: 'Method not allowed', requestId }); return finish(405); }
      if (isApi) { json(res, 404, { error: 'Endpoint not implemented', requestId }); return finish(404); }
      await fallback(req, res, url);
      return finish(res.statusCode);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error?.name === 'UpstreamError' ? 502 : 500;
      if (status >= 500) log.error('request failed', { status, error });
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'Internal error' : error.message, details: error.details, requestId });
      else res.end();
      return finish(status);
    }
  };
  return api;
}
