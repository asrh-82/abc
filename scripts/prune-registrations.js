process.umask(0o077);

const config = require('../src/config');
const { migrateDatabase, openDatabase, pruneExpiredRegistrations } = require('../src/db');

const db = openDatabase(config.databasePath);
try {
  migrateDatabase(db, config.migrationsPath);
  const deleted = pruneExpiredRegistrations(
    db,
    new Date(),
    config.registrationRetentionDays
  );
  console.log(`Deleted ${deleted} expired registration record${deleted === 1 ? '' : 's'}.`);
} finally {
  db.close();
}
