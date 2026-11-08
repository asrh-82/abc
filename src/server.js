process.umask(0o077);

const config = require('./config');
const { createApp } = require('./app');
const {
  assertEventEndTimesReady,
  assertAbcDatabase,
  configureDatabaseFile,
  createRepositories,
  migrateDatabase,
  openDatabase,
  pruneExpiredRegistrations,
  syncEventsFromManifest,
} = require('./db');
const { loadEventManifest } = require('./event-manifest');
const { createTurnstileVerifier } = require('./turnstile');

const db = openDatabase(config.databasePath, { configureFile: false });
migrateDatabase(db, config.migrationsPath);
assertAbcDatabase(db);
configureDatabaseFile(db, config.databasePath);
syncEventsFromManifest(db, loadEventManifest(config.eventManifestPath));
assertEventEndTimesReady(db);
pruneExpiredRegistrations(db, new Date(), config.registrationRetentionDays);

const app = createApp({
  repositories: createRepositories(db),
  projectRoot: config.projectRoot,
  isProduction: config.isProduction,
  trustProxy: config.trustProxy,
  registrationRetentionDays: config.registrationRetentionDays,
  siteConfig: config.site,
  turnstileSiteKey: config.turnstileSiteKey,
  registrationProtectionReady: config.registrationProtectionReady,
  verifyHuman: createTurnstileVerifier({
    secretKey: config.turnstileSecretKey,
    expectedHostnames: config.turnstileExpectedHostnames,
  }),
});

const onListening = () => {
  const hostLabel = config.host ? `${config.host}:` : '';
  console.log(`ABC website listening on ${hostLabel}${config.port}`);
};
const server = config.host
  ? app.listen(config.port, config.host, onListening)
  : app.listen(config.port, onListening);

const retentionTimer = setInterval(() => {
  pruneExpiredRegistrations(db, new Date(), config.registrationRetentionDays);
}, 24 * 60 * 60 * 1000);
retentionTimer.unref();

function shutdown(signal) {
  console.log(`${signal} received; closing the server.`);
  clearInterval(retentionTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
