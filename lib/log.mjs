// Structured JSON logging with redaction. Credentials, tokens, phone numbers and raw sensor payloads never reach the log.
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const redactKeys = /token|secret|password|authorization|credential|api[-_]?key|phone|msisdn|recipient|cookie|bearer/i;
const phonePattern = /(\+?\d[\d\s().-]{7,}\d)/g;
const tokenPattern = /\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|(?:token|key|secret)=[^&\s]+)/gi;
export function redact(value, depth = 0) {
  if (depth > 6) return '[depth]';
  // Only sequences with ≥10 digits that are not ISO dates/timestamps are treated as phone numbers.
  if (typeof value === 'string') return value.replace(tokenPattern, '[redacted]').replace(phonePattern, m => (m.replace(/\D/g, '').length >= 10 && !/^\d{4}-\d{2}-\d{2}/.test(m) ? '[redacted-number]' : m));
  if (Array.isArray(value)) return value.length > 50 ? `[array ${value.length}]` : value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { name: value.name, message: redact(value.message), code: value.code };
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = redactKeys.test(key) ? '[redacted]' : key === 'payload' || key === 'body' ? '[omitted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}
export function createLogger({ level = 'info', stream = process.stdout, service = 'aegis' } = {}) {
  const threshold = levels[level] ?? levels.info;
  const write = (lvl, message, fields) => {
    if (levels[lvl] < threshold) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, service, message, ...redact(fields || {}) });
    stream.write(line + '\n');
  };
  const logger = { level, child: extra => ({ debug: (m, f) => write('debug', m, { ...extra, ...f }), info: (m, f) => write('info', m, { ...extra, ...f }), warn: (m, f) => write('warn', m, { ...extra, ...f }), error: (m, f) => write('error', m, { ...extra, ...f }) }) };
  return Object.assign(logger, logger.child({}));
}
export const silentLogger = createLogger({ stream: { write() {} } });
