const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

module.exports = {
  projectRoot,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  databasePath: process.env.DATABASE_PATH || path.join(projectRoot, 'var', 'abc.sqlite'),
  migrationsPath: path.join(projectRoot, 'db', 'migrations'),
  eventManifestPath: path.join(projectRoot, 'data', 'events.json'),
  isProduction: process.env.NODE_ENV === 'production',
  registrationRetentionDays: Number.parseInt(process.env.REGISTRATION_RETENTION_DAYS || '30', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
  turnstileExpectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME || '',
  registrationProtectionReady: Boolean(
    process.env.TURNSTILE_SITE_KEY &&
    process.env.TURNSTILE_SECRET_KEY &&
    process.env.TURNSTILE_EXPECTED_HOSTNAME
  ),
};

function parseTrustProxy(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}
