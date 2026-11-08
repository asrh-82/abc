process.umask(0o077);

const config = require('../src/config');
const {
  assertAbcDatabase,
  configureDatabaseFile,
  migrateDatabase,
  openDatabase,
} = require('../src/db');
const { parseArgs, printError } = require('./lib/args');
const { printDatabasePath } = require('./lib/database');

let db;
try {
  parseArgs(process.argv.slice(2));
  printDatabasePath();
  db = openDatabase(config.databasePath, { configureFile: false });
  migrateDatabase(db, config.migrationsPath);
  assertAbcDatabase(db);
  configureDatabaseFile(db, config.databasePath);
  console.log('Database migrations are up to date.');
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
