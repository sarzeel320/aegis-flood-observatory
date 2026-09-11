// Subscriptions, verified consent, advisories with authority approval, delivery queue with idempotency.
// Sending is disabled unless NOTIFICATION_SENDS_ENABLED=true and a provider is configured; there is no real provider
// adapter in this repository, so queued deliveries stay 'held' and no message leaves the system.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http/router.mjs';
export const templates = {
  'flood-advisory': {
    id: 'flood-advisory', version: '1.0.0', languages: ['en', 'hi'],
    render(f, language) {
      const link = f.officialLink;
      if (language === 'hi') return `${f.authority} चेतावनी · ${f.affectedArea}\nजारी: ${f.issuedAt} · मान्य: ${f.expiresAt} तक\nसलाह: ${f.recommendedAction}\nआधिकारिक सूचना: ${link}\n${f.supersedes ? 'यह संदेश पिछली सलाह का स्थान लेता है।\n' : ''}सदस्यता समाप्त करने के लिए STOP लिखें।`;
      return `${f.authority} advisory · ${f.affectedArea}\nIssued ${f.issuedAt} · valid until ${f.expiresAt}\nAction: ${f.recommendedAction}\nOfficial warning: ${link}\n${f.supersedes ? 'This update replaces the previous advisory.\n' : ''}Reply STOP to unsubscribe.`;
    },
    cancel(f, language) { return language === 'hi' ? `${f.authority}: ${f.affectedArea} के लिए पहले भेजी गई सलाह रद्द कर दी गई है। आधिकारिक अपडेट: ${f.officialLink}` : `${f.authority}: the advisory for ${f.affectedArea} has been cancelled. Official updates: ${f.officialLink}`; }
  }
};
export const consentTextVersion = '2026-09-11-v1';
const e164 = /^\+[1-9]\d{7,14}$/;
export function createNotifications({ store, config, catchments, logger }) {
  const secret = config.ADVISORY_AUTHORITY_KEY || config.ADMIN_API_KEY || 'aegis-local-dev';
  const hash = value => createHmac('sha256', secret).update(String(value)).digest('hex');
  const sha = value => createHash('sha256').update(String(value)).digest('hex');
  const sendsEnabled = config.NOTIFICATION_SENDS_ENABLED && config.NOTIFICATION_PROVIDER !== 'none';
  const audit = (entry) => store.audit.record(entry);
  const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
  function publicSubscription(row) { return { id: row.id, channel: row.channel, addressMasked: `${row.address.slice(0, 3)}…${row.address.slice(-2)}`, language: row.language, catchmentId: row.catchment_id, status: row.status, consentTextVersion: row.consent_text_version, consentRecordedAt: row.consent_recorded_at, verifiedAt: row.verified_at, unsubscribedAt: row.unsubscribed_at, createdAt: row.created_at }; }
  function createSubscription(body, ctx) {
    const { channel, address, language, catchmentId, consent } = body ?? {};
    if (!['sms', 'whatsapp'].includes(channel)) throw new HttpError(400, 'channel must be sms or whatsapp');
    if (typeof address !== 'string' || !e164.test(address)) throw new HttpError(400, 'address must be an E.164 phone number');
    if (!['en', 'hi'].includes(language)) throw new HttpError(400, 'language must be en or hi');
    if (!catchments.get(catchmentId)) throw new HttpError(404, 'Unknown catchment');
    if (consent?.accepted !== true || consent?.textVersion !== consentTextVersion) throw new HttpError(400, `consent.accepted must be true and consent.textVersion must be ${consentTextVersion}`);
    const addressHash = hash(address);
    const existing = store.subscriptions.findByHash(channel, addressHash, catchmentId);
    if (existing && existing.status !== 'unsubscribed') return { status: 200, body: { subscription: publicSubscription(existing), verification: { status: existing.status === 'active' ? 'already verified' : 'pending', delivery: 'not sent: sends disabled' } } };
    const code = String(randomInt(100000, 999999));
    const row = store.subscriptions.create({ channel, address, addressHash, language, catchmentId, status: 'pending-verification', consentTextVersion, verificationCodeHash: sha(code), verificationExpiresAt: new Date(Date.now() + 15 * 60000).toISOString(), unsubscribeToken: randomBytes(24).toString('base64url') });
    audit({ actor: ctx?.ip, action: 'subscription.create', subjectType: 'subscription', subjectId: row.id, requestId: ctx?.requestId, details: { channel, language, catchmentId } });
    const verification = { status: 'pending', delivery: sendsEnabled ? 'queued' : 'not sent: NOTIFICATION_SENDS_ENABLED is false or no provider is configured', expiresAt: row.verification_expires_at };
    if (config.NODE_ENV !== 'production') verification.devVerificationCode = code; // non-production only: lets tests exercise verification without a provider
    return { status: 201, body: { subscription: publicSubscription(row), verification, unsubscribeToken: row.unsubscribe_token } };
  }
  function verifySubscription(id, body, ctx) {
    const row = store.subscriptions.get(id);
    if (!row) throw new HttpError(404, 'Unknown subscription');
    if (row.status === 'active') return { subscription: publicSubscription(row) };
    if (row.status !== 'pending-verification' || !row.verification_code_hash) throw new HttpError(409, 'Subscription is not awaiting verification');
    if (Date.parse(row.verification_expires_at) < Date.now()) throw new HttpError(410, 'Verification code expired');
    if (typeof body?.code !== 'string' || !safeEqual(sha(body.code), row.verification_code_hash)) throw new HttpError(400, 'Invalid verification code');
    store.subscriptions.verify(id);
    audit({ actor: ctx?.ip, action: 'subscription.verify', subjectType: 'subscription', subjectId: id, requestId: ctx?.requestId });
    return { subscription: publicSubscription(store.subscriptions.get(id)) };
  }
  function unsubscribe(token, ctx) {
    const row = store.subscriptions.findByToken(token);
    if (!row) throw new HttpError(404, 'Unknown unsubscribe token');
    if (row.status !== 'unsubscribed') { store.subscriptions.unsubscribe(row.id); audit({ actor: ctx?.ip, action: 'subscription.unsubscribe', subjectType: 'subscription', subjectId: row.id, requestId: ctx?.requestId }); }
    return { subscription: publicSubscription(store.subscriptions.get(row.id)) };
  }
  function publicAdvisory(row) { return { id: row.id, catchmentId: row.catchment_id, status: row.status, authority: row.authority, templateId: row.template_id, templateVersion: row.template_version, issuedAt: row.issued_at, expiresAt: row.expires_at, affectedArea: row.affected_area, recommendedAction: row.recommended_action, officialLink: row.official_link, supersedes: row.supersedes, approvedBy: row.approved_by, approvedAt: row.approved_at, cancelledAt: row.cancelled_at, createdAt: row.created_at, namespace: 'advisory', notes: row.payload?.notes ?? null, previews: row.payload?.previews ?? null }; }
  function createAdvisory(body, ctx) {
    const { catchmentId, authority, templateId = 'flood-advisory', issuedAt, expiresAt, affectedArea, recommendedAction, officialLink, supersedes, notes } = body ?? {};
    if (!catchments.get(catchmentId)) throw new HttpError(404, 'Unknown catchment');
    const template = templates[templateId];
    if (!template) throw new HttpError(400, 'Unknown template');
    for (const [k, v] of Object.entries({ authority, affectedArea, recommendedAction })) if (typeof v !== 'string' || v.trim().length < 3 || v.length > 400) throw new HttpError(400, `${k} is required (3–400 characters)`);
    if (typeof officialLink !== 'string' || !/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(officialLink)) throw new HttpError(400, 'officialLink must be an https URL to the official warning');
    const issued = Date.parse(issuedAt ?? ''), expires = Date.parse(expiresAt ?? '');
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) throw new HttpError(400, 'issuedAt and expiresAt must be ISO timestamps with expiresAt after issuedAt');
    if (supersedes && !store.advisories.get(supersedes)) throw new HttpError(404, 'supersedes refers to an unknown advisory');
    const fields = { authority: authority.trim(), affectedArea: affectedArea.trim(), recommendedAction: recommendedAction.trim(), officialLink, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(expires).toISOString(), supersedes: supersedes ?? null };
    const previews = Object.fromEntries(template.languages.map(l => [l, template.render(fields, l)]));
    const row = store.advisories.create({ catchmentId, authority: fields.authority, templateId, templateVersion: template.version, issuedAt: fields.issuedAt, expiresAt: fields.expiresAt, affectedArea: fields.affectedArea, recommendedAction: fields.recommendedAction, officialLink, supersedes: fields.supersedes, payload: { notes: typeof notes === 'string' ? notes.slice(0, 2000) : null, previews } });
    audit({ actor: ctx?.ip, action: 'advisory.create', subjectType: 'advisory', subjectId: row.id, requestId: ctx?.requestId, details: { catchmentId, templateId, templateVersion: template.version } });
    return { status: 201, body: { advisory: publicAdvisory(row), approval: 'required: POST /api/v1/advisories/:id/approve with the authority key' } };
  }
  function requireAuthority(ctx) {
    const header = ctx.req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!config.ADVISORY_AUTHORITY_KEY) throw new HttpError(503, 'Advisory approval is disabled: ADVISORY_AUTHORITY_KEY is not configured');
    if (!provided || !safeEqual(provided, config.ADVISORY_AUTHORITY_KEY)) throw new HttpError(401, 'Authority key required');
  }
  function approveAdvisory(id, body, ctx) {
    requireAuthority(ctx);
    const row = store.advisories.get(id);
    if (!row) throw new HttpError(404, 'Unknown advisory');
    if (row.status !== 'draft') throw new HttpError(409, `Advisory is ${row.status}, not draft`);
    if (Date.parse(row.expires_at) < Date.now()) throw new HttpError(409, 'Advisory already expired');
    const approvedBy = typeof body?.approvedBy === 'string' && body.approvedBy.trim() ? body.approvedBy.trim().slice(0, 120) : 'authority';
    store.advisories.setStatus(id, 'approved', { approved_by: approvedBy, approved_at: new Date().toISOString() });
    if (row.supersedes) { const prev = store.advisories.get(row.supersedes); if (prev && ['approved', 'issued'].includes(prev.status)) store.advisories.setStatus(prev.id, 'superseded'); }
    const recipients = store.subscriptions.active(row.catchment_id);
    const queued = [];
    for (const sub of recipients) { const r = store.deliveries.enqueue({ advisoryId: id, subscriptionId: sub.id, idempotencyKey: `${id}:${sub.id}:${row.template_version}`, status: sendsEnabled ? 'queued' : 'held', provider: config.NOTIFICATION_PROVIDER }); queued.push(r); }
    store.advisories.setStatus(id, 'issued');
    audit({ actor: approvedBy, action: 'advisory.approve', subjectType: 'advisory', subjectId: id, requestId: ctx?.requestId, details: { recipients: recipients.length, created: queued.filter(q => q.created).length, deliveryStatus: sendsEnabled ? 'queued' : 'held' } });
    return { advisory: publicAdvisory(store.advisories.get(id)), deliveries: { recipients: recipients.length, created: queued.filter(q => q.created).length, duplicatesIgnored: queued.filter(q => !q.created).length, status: sendsEnabled ? 'queued' : 'held (sends disabled)' } };
  }
  function cancelAdvisory(id, body, ctx) {
    requireAuthority(ctx);
    const row = store.advisories.get(id);
    if (!row) throw new HttpError(404, 'Unknown advisory');
    if (['cancelled'].includes(row.status)) return { advisory: publicAdvisory(row) };
    store.advisories.setStatus(id, 'cancelled', { cancelled_at: new Date().toISOString() });
    for (const d of store.deliveries.listForAdvisory(id)) if (['held', 'queued'].includes(d.status)) store.deliveries.update(d.id, { status: 'cancelled' });
    audit({ actor: 'authority', action: 'advisory.cancel', subjectType: 'advisory', subjectId: id, requestId: ctx?.requestId, details: { reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null } });
    return { advisory: publicAdvisory(store.advisories.get(id)), cancellationMessagePreview: Object.fromEntries(templates[row.template_id].languages.map(l => [l, templates[row.template_id].cancel({ authority: row.authority, affectedArea: row.affected_area, officialLink: row.official_link }, l)])) };
  }
  function providerStatus() {
    return { provider: config.NOTIFICATION_PROVIDER, sendsEnabled, adapters: { sms: 'not implemented', whatsapp: 'not implemented' }, subscriptions: Object.fromEntries(store.subscriptions.counts().map(r => [r.status, r.n])), deliveries: Object.fromEntries(store.deliveries.counts().map(r => [r.status, r.n])), templates: Object.values(templates).map(t => ({ id: t.id, version: t.version, languages: t.languages })), consentTextVersion, note: 'No message can be sent by this service. Delivery rows are held until a provider adapter, provider template approval and an operator decision exist.' };
  }
  return { createSubscription, verifySubscription, unsubscribe, createAdvisory, approveAdvisory, cancelAdvisory, providerStatus, publicAdvisory, get: id => { const r = store.advisories.get(id); return r ? publicAdvisory(r) : null; } };
}
