// Outbound HTTP with fixed upstream hosts, timeouts, retry with backoff, and bounded response sizes.
export const allowedHosts = new Set([
  'api.open-meteo.com', 'ensemble-api.open-meteo.com', 'flood-api.open-meteo.com', 'archive-api.open-meteo.com', 'geocoding-api.open-meteo.com',
  'cmr.earthdata.nasa.gov', 'data.nsidc.earthdatacloud.nasa.gov', 'n5eil01u.ecs.nsidc.org', 'urs.earthdata.nasa.gov',
  'api.worldpop.org', 'zenodo.org', 'data.hydrosheds.org', 'data.ecmwf.int'
]);
export class UpstreamError extends Error { constructor(message, { status, host, retryable = false, cause } = {}) { super(message, { cause }); this.name = 'UpstreamError'; this.status = status; this.host = host; this.retryable = retryable; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function createFetcher({ timeoutMs = 12000, maxBytes = 8 * 1024 * 1024, retries = 2, baseDelayMs = 400, fetchImpl = globalThis.fetch, logger, hosts = allowedHosts } = {}) {
  return async function boundedFetch(input, { headers = {}, method = 'GET', body, expect = 'json', signal } = {}) {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') throw new UpstreamError('Only https upstreams are permitted', { host: url.hostname });
    if (!hosts.has(url.hostname)) throw new UpstreamError(`Upstream host is not allow-listed: ${url.hostname}`, { host: url.hostname });
    let attempt = 0, lastError;
    while (attempt <= retries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      const onAbort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const started = Date.now();
      try {
        const response = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) throw new UpstreamError('Upstream redirect refused', { status: response.status, host: url.hostname });
        if (response.status === 429 || response.status >= 500) throw new UpstreamError(`Upstream returned ${response.status}`, { status: response.status, host: url.hostname, retryable: true });
        if (!response.ok) throw new UpstreamError(`Upstream returned ${response.status}`, { status: response.status, host: url.hostname });
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamError('Upstream response exceeds size bound', { host: url.hostname });
        const chunks = []; let received = 0;
        for await (const chunk of response.body ?? []) { received += chunk.byteLength; if (received > maxBytes) throw new UpstreamError('Upstream response exceeds size bound', { host: url.hostname }); chunks.push(chunk); }
        const buffer = Buffer.concat(chunks);
        logger?.debug('upstream ok', { host: url.hostname, path: url.pathname, status: response.status, bytes: received, ms: Date.now() - started, attempt });
        if (expect === 'buffer') return buffer;
        const text = buffer.toString('utf8');
        if (expect === 'text') return text;
        try { return JSON.parse(text); } catch (cause) { throw new UpstreamError('Upstream returned invalid JSON', { host: url.hostname, cause }); }
      } catch (error) {
        lastError = error instanceof UpstreamError ? error : new UpstreamError(error?.name === 'AbortError' || error?.message === 'timeout' ? 'Upstream timed out' : 'Upstream request failed', { host: url.hostname, retryable: true, cause: error });
        logger?.warn('upstream failure', { host: url.hostname, path: url.pathname, attempt, ms: Date.now() - started, error: lastError.message, status: lastError.status });
        if (!lastError.retryable || attempt === retries || signal?.aborted) break;
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 100);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
      attempt++;
    }
    throw lastError;
  };
}
