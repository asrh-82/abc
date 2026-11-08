process.umask(0o077);

const config = require('../src/config');
const { migrateDatabase, openDatabase } = require('../src/db');

const db = openDatabase(config.databasePath);
try {
  migrateDatabase(db, config.migrationsPath);
  console.log('Database migrations are up to date.');
} finally {
  db.close();
}
