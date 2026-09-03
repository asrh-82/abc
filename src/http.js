const crypto = require('node:crypto');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, entry) => {
    const separator = entry.indexOf('=');
    if (separator === -1) return cookies;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        // Ignore malformed cookie values instead of turning a bad request into a server error.
      }
    }
    return cookies;
  }, {});
}

function issueCsrfToken(req, res, isProduction) {
  const existingToken = parseCookies(req.headers.cookie).abc_csrf || '';
  const token = /^[a-f0-9]{48}$/.test(existingToken)
    ? existingToken
    : crypto.randomBytes(24).toString('hex');
  if (token === existingToken) return token;
  const secure = isProduction ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `abc_csrf=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`
  );
  return token;
}

function verifyCsrfToken(req) {
  const cookieToken = parseCookies(req.headers.cookie).abc_csrf || '';
  const formToken = String(req.body.csrfToken || '');
  if (!cookieToken || !formToken) return false;
  const cookieBuffer = Buffer.from(cookieToken);
  const formBuffer = Buffer.from(formToken);
  if (cookieBuffer.length !== formBuffer.length) return false;
  return crypto.timingSafeEqual(cookieBuffer, formBuffer);
}

function formatEventDate(event) {
  const date = new Date(event.startsAt);
  return {
    month: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      timeZone: event.timezone,
    }).format(date),
    day: new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      timeZone: event.timezone,
    }).format(date),
    year: new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      timeZone: event.timezone,
    }).format(date),
    fullDate: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: event.timezone,
    }).format(date),
    time: new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: event.timezone,
      timeZoneName: 'short',
    }).format(date),
  };
}

function formatMoney(cents) {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

module.exports = {
  escapeHtml,
  formatEventDate,
  formatMoney,
  issueCsrfToken,
  parseCookies,
  verifyCsrfToken,
};
