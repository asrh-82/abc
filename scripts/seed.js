process.umask(0o077);

const config = require('../src/config');
const { migrateDatabase, openDatabase, seedEventsIfEmpty } = require('../src/db');

const db = openDatabase(config.databasePath);
try {
  migrateDatabase(db, config.migrationsPath);
  const seeded = seedEventsIfEmpty(db, config.eventSeedPath);
  console.log(seeded ? 'Seeded event data.' : 'Event data already exists; nothing changed.');
} finally {
  db.close();
}
