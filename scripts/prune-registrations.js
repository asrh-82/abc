process.umask(0o077);

const config = require('../src/config');
const { pruneExpiredRegistrations } = require('../src/db');
const { parseArgs, printError } = require('./lib/args');
const { openOrganizerDatabase, printDatabasePath } = require('./lib/database');

let db;
try {
  parseArgs(process.argv.slice(2));
  printDatabasePath();
  ({ db } = openOrganizerDatabase());
  const deleted = pruneExpiredRegistrations(
    db,
    new Date(),
    config.registrationRetentionDays
  );
  console.log(`Deleted ${deleted} expired registration record${deleted === 1 ? '' : 's'}.`);
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
