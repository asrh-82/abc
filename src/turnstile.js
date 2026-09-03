const crypto = require('node:crypto');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_ACTION = 'event-registration';

function asUuid(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function createTurnstileVerifier({
  secretKey = '',
  expectedHostname = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
} = {}) {
  return async function verifyHuman({ token = '', remoteIp = '', idempotencyKey = '' } = {}) {
    if (!secretKey) {
      return { ok: false, unavailable: true };
    }

    const normalizedToken = String(token).trim();
    if (!normalizedToken || normalizedToken.length > 2_048) return { ok: false };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    try {
      const payload = {
        secret: secretKey,
        response: normalizedToken,
      };
      if (remoteIp) payload.remoteip = String(remoteIp);
      if (idempotencyKey) {
        payload.idempotency_key = asUuid(`${String(idempotencyKey)}\0${normalizedToken}`);
      }

      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, unavailable: true };

      const result = await response.json();
      if (!result.success || result.action !== EXPECTED_ACTION) return { ok: false };
      if (expectedHostname && result.hostname !== expectedHostname) return { ok: false };
      return { ok: true };
    } catch {
      return { ok: false, unavailable: true };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = {
  EXPECTED_ACTION,
  SITEVERIFY_URL,
  createTurnstileVerifier,
};
