const fs = require('node:fs');
const path = require('node:path');

const config = require('../../src/config');
const {
  assertAbcDatabase,
  configureDatabaseFile,
  createRepositories,
  migrateDatabase,
  openDatabase,
} = require('../../src/db');

function openOrganizerDatabase() {
  const db = openDatabase(config.databasePath, {
    configureFile: false,
    existingOnly: true,
  });
  try {
    assertAbcDatabase(db);
    configureDatabaseFile(db, config.databasePath);
    migrateDatabase(db, config.migrationsPath);
    return { db, repositories: createRepositories(db) };
  } catch (error) {
    db.close();
    throw error;
  }
}

function assertCurrentMigrations(db) {
  const expectedMigrations = fs.readdirSync(config.migrationsPath)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  let appliedMigrations;
  try {
    appliedMigrations = new Set(
      db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name)
    );
  } catch {
    throw new Error('This command requires a migrated ABC database. Run npm run db:migrate first.');
  }
  const missing = expectedMigrations.filter((name) => !appliedMigrations.has(name));
  if (missing.length > 0) {
    throw new Error(`This command requires current migrations. Missing: ${missing.join(', ')}.`);
  }
}

function openReadOnlyOrganizerDatabase() {
  const db = openDatabase(config.databasePath, {
    configureFile: false,
    existingOnly: true,
    readOnly: true,
  });
  try {
    db.exec('PRAGMA query_only = ON;');
    assertAbcDatabase(db);
    assertCurrentMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function resolvedDatabasePath() {
  return path.resolve(config.databasePath);
}

function printDatabasePath() {
  console.log(`Database: ${resolvedDatabasePath()}`);
}

module.exports = {
  assertCurrentMigrations,
  openOrganizerDatabase,
  openReadOnlyOrganizerDatabase,
  printDatabasePath,
  resolvedDatabasePath,
};
