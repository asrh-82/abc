const crypto = require('node:crypto');

const CONSENT_VERSION = '2026-09-03';

function toPublicEvent(row, now = new Date()) {
  const hasEnded = Date.parse(row.starts_at) <= now.getTime();
  const beforeRegistrationWindow =
    row.registration_opens_at && Date.parse(row.registration_opens_at) > now.getTime();
  const afterRegistrationWindow =
    row.registration_closes_at && Date.parse(row.registration_closes_at) <= now.getTime();
  const remaining = row.capacity === null ? null : Math.max(0, row.capacity - row.reserved);
  const effectiveStatus =
    hasEnded && row.status !== 'cancelled' && row.status !== 'draft'
      ? 'completed'
      : row.status;
  let registrationState = 'closed';
  if (effectiveStatus === 'cancelled') registrationState = 'cancelled';
  else if (effectiveStatus === 'completed' || hasEnded) registrationState = 'completed';
  else if (remaining === 0) registrationState = 'full';
  else if (effectiveStatus !== 'open' || afterRegistrationWindow) registrationState = 'closed';
  else if (beforeRegistrationWindow) registrationState = 'not_yet_open';
  else registrationState = 'open';
  const registrationOpen = registrationState === 'open';

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    startsAt: row.starts_at,
    timezone: row.timezone,
    locationName: row.location_name,
    costLabel: row.cost_label,
    partner: row.partner,
    fundsRaisedCents: row.funds_raised_cents,
    status: effectiveStatus,
    capacity: row.capacity,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    registrationState,
    remaining,
    registrationOpen,
  };
}

function splitEvents(rows, now = new Date()) {
  const events = rows.map((row) => toPublicEvent(row, now));
  return {
    upcoming: events
      .filter((event) => event.status !== 'completed' && Date.parse(event.startsAt) > now.getTime())
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    past: events
      .filter((event) => event.status === 'completed' || Date.parse(event.startsAt) <= now.getTime())
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
  };
}

function normalizeRegistration(payload) {
  const partySizeValue =
    typeof payload.partySize === 'number'
      ? payload.partySize
      : Number(String(payload.partySize ?? '').trim());
  const values = {
    contactName: String(payload.contactName || '').trim().replace(/\s+/g, ' '),
    email: String(payload.email || '').trim(),
    partySize: partySizeValue,
    consent: payload.consent === true || payload.consent === 'on',
    website: String(payload.website || '').trim(),
    idempotencyKey: String(payload.idempotencyKey || '').trim(),
    turnstileToken: String(
      payload.turnstileToken || payload['cf-turnstile-response'] || ''
    ).trim(),
  };
  values.emailNormalized = values.email.toLowerCase();
  return values;
}

function validateRegistration(payload) {
  const values = normalizeRegistration(payload);
  const errors = {};

  if (values.website) errors.form = 'We could not process that registration.';
  if (values.contactName.length < 2 || values.contactName.length > 80) {
    errors.contactName = 'Enter a contact name between 2 and 80 characters.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || values.email.length > 254) {
    errors.email = 'Enter a valid email address.';
  }
  if (!Number.isInteger(values.partySize) || values.partySize < 1 || values.partySize > 10) {
    errors.partySize = 'Choose between 1 and 10 spots.';
  }
  if (!values.consent) errors.consent = 'Confirm that ABC may contact you about this event.';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(values.idempotencyKey)) {
    errors.form = 'Refresh the page and try again.';
  }

  return { values, errors, valid: Object.keys(errors).length === 0 };
}

function buildRegistration(values) {
  const requestFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify([
      values.contactName,
      values.emailNormalized,
      values.partySize,
      CONSENT_VERSION,
    ]))
    .digest('hex');

  return {
    id: crypto.randomUUID(),
    contactName: values.contactName,
    email: values.email,
    emailNormalized: values.emailNormalized,
    partySize: values.partySize,
    consentVersion: CONSENT_VERSION,
    confirmationCode: crypto.randomBytes(9).toString('base64url'),
    idempotencyKey: values.idempotencyKey,
    requestFingerprint,
  };
}

module.exports = {
  CONSENT_VERSION,
  buildRegistration,
  splitEvents,
  toPublicEvent,
  validateRegistration,
};
