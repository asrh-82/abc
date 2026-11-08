process.umask(0o077);

const config = require('../src/config');
const { compareEventStatuses } = require('../src/db');
const { loadEventManifest } = require('../src/event-manifest');
const { parseArgs, printError } = require('./lib/args');
const {
  openReadOnlyOrganizerDatabase,
  printDatabasePath,
} = require('./lib/database');

function describeDifference(difference) {
  if (difference.code === 'missing_database_event') {
    return `${difference.id} (${difference.slug}) is in the manifest but not the database.`;
  }
  if (difference.code === 'missing_manifest_event') {
    return `${difference.id} (${difference.slug}) is in the database but not the manifest.`;
  }
  if (difference.code === 'slug_mismatch') {
    return `${difference.id} uses manifest slug ${difference.slug} and database slug ${difference.storedSlug}.`;
  }
  return `${difference.id} (${difference.slug}) uses manifest=${difference.manifestStatus} and database=${difference.storedStatus}.`;
}

let db;
try {
  parseArgs(process.argv.slice(2));
  printDatabasePath();
  console.log(`Manifest: ${config.eventManifestPath}`);
  const events = loadEventManifest(config.eventManifestPath);
  db = openReadOnlyOrganizerDatabase();
  const comparison = compareEventStatuses(db, events);

  for (const warning of comparison.warnings) {
    console.warn(
      `Warning: ${describeDifference(warning)} ` +
      'A locally closed registration service may be intentional while the event remains listed.'
    );
  }
  for (const error of comparison.errors) {
    console.error(`Mismatch: ${describeDifference(error)}`);
  }

  if (comparison.errors.length > 0) {
    console.error(
      'Event status consistency check failed. Resolve the differences before publishing a Vercel preview.'
    );
    process.exitCode = 1;
  } else if (comparison.warnings.length > 0) {
    console.log('Event status consistency check passed with local-closure warnings.');
  } else {
    console.log('Event manifest and local database statuses are aligned.');
  }
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
