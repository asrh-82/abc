process.umask(0o077);

const config = require('../src/config');
const {
  planEventSync,
  syncEventsFromManifest,
} = require('../src/db');
const { loadEventManifest } = require('../src/event-manifest');
const { parseArgs, printError } = require('./lib/args');
const {
  openOrganizerDatabase,
  openReadOnlyOrganizerDatabase,
  printDatabasePath,
} = require('./lib/database');

let db;
try {
  const args = parseArgs(process.argv.slice(2), { booleans: ['dry-run'] });
  const events = loadEventManifest(config.eventManifestPath);
  const dryRun = args['dry-run'] === true;
  let result;
  printDatabasePath();

  if (dryRun) {
    db = openReadOnlyOrganizerDatabase();
    result = planEventSync(db, events, { includeDetails: true });
  } else {
    ({ db } = openOrganizerDatabase());
    result = syncEventsFromManifest(db, events, { includeDetails: true });
  }

  const prefix = dryRun ? 'Dry run:' : 'Synced:';
  console.log(
    `${prefix} ${result.inserted} inserted, ${result.updated} updated, ` +
      `${result.unchanged} unchanged.`
  );
  for (const change of result.changes) {
    console.log(`- ${change.type} ${change.id} (${change.slug}): ${change.fields.join(', ')}`);
  }
  if (result.statusDivergences.length > 0) {
    console.log('Status differences (database status is preserved):');
    for (const difference of result.statusDivergences) {
      console.log(
        `- ${difference.id} (${difference.slug}): manifest=${difference.manifestStatus}, ` +
        `database=${difference.storedStatus} [${difference.severity}]`
      );
    }
  }
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
