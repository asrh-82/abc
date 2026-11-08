const path = require('node:path');
const { loadSiteConfig } = require('./site-config');

const projectRoot = path.resolve(__dirname, '..');
const serverOptions = parseServerOptions(process.argv.slice(2));
const turnstileExpectedHostnames = parseList(
  [process.env.TURNSTILE_EXPECTED_HOSTNAMES, process.env.TURNSTILE_EXPECTED_HOSTNAME]
    .filter(Boolean)
    .join(',')
);

module.exports = {
  projectRoot,
  port: serverOptions.port || Number.parseInt(process.env.PORT || '3000', 10),
  host: serverOptions.host || process.env.HOST || '',
  databasePath: process.env.DATABASE_PATH || path.join(projectRoot, 'var', 'abc.sqlite'),
  migrationsPath: path.join(projectRoot, 'db', 'migrations'),
  eventManifestPath: path.join(projectRoot, 'data', 'events.json'),
  isProduction: process.env.NODE_ENV === 'production',
  registrationRetentionDays: Number.parseInt(process.env.REGISTRATION_RETENTION_DAYS || '30', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
  turnstileExpectedHostnames,
  registrationProtectionReady: Boolean(
    process.env.TURNSTILE_SITE_KEY &&
    process.env.TURNSTILE_SECRET_KEY &&
    turnstileExpectedHostnames.length
  ),
  site: loadSiteConfig(process.env),
};

function parseTrustProxy(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseServerOptions(args = []) {
  const result = { port: null, host: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (argument === '--strictPort') continue;

    const [flag, inlineValue] = argument.split('=', 2);
    if (flag !== '--port' && flag !== '--host') continue;
    const value = inlineValue === undefined ? args[index += 1] : inlineValue;
    if (value === undefined || String(value).startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }

    if (flag === '--port') {
      if (!/^\d+$/.test(String(value))) throw new Error('--port must be an integer.');
      const port = Number.parseInt(String(value), 10);
      if (port < 1 || port > 65_535) throw new Error('--port must be between 1 and 65535.');
      result.port = port;
    } else {
      const host = String(value).trim();
      if (!host || host.length > 253 || /\s/.test(host)) throw new Error('--host is invalid.');
      result.host = host;
    }
  }
  return result;
}

module.exports.parseServerOptions = parseServerOptions;
