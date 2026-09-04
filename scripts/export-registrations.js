process.umask(0o077);

const path = require('node:path');

const {
  validateActor,
  validateReason,
  writeAuditedRegistrationCsv,
} = require('../src/organizer');
const { parseArgs, printError, requiredArg } = require('./lib/args');
const { openOrganizerDatabase, printDatabasePath } = require('./lib/database');

let db;
try {
  const args = parseArgs(process.argv.slice(2), {
    allowed: ['event', 'out', 'actor', 'reason'],
    booleans: ['force'],
  });
  const slug = requiredArg(args, 'event');
  const outputPath = path.resolve(requiredArg(args, 'out'));
  const actor = validateActor(requiredArg(args, 'actor'));
  const reason = validateReason(requiredArg(args, 'reason'));
  printDatabasePath();
  let repositories;
  ({ db, repositories } = openOrganizerDatabase());

  const summary = repositories.registrations.summaryForEvent(slug);
  if (!summary) throw new Error(`Event not found: ${slug}`);
  const rows = repositories.registrations.listForEvent(slug);
  writeAuditedRegistrationCsv({
    outputPath,
    rows,
    force: args.force === true,
    recordAudit: () => repositories.audit.record({
      action: 'registrations.exported',
      actor,
      eventId: summary.event_id,
      reason,
      details: { rowCount: rows.length },
      now: new Date(),
    }),
  });
  console.log(`Exported ${rows.length} registration record${rows.length === 1 ? '' : 's'} to ${outputPath}.`);
  console.warn('The CSV contains personal data; store it securely and delete it when no longer needed.');
} catch (error) {
  if (error.code === 'EEXIST') {
    printError(new Error('The output file already exists. Choose another path or pass --force.'));
  } else {
    printError(error);
  }
} finally {
  if (db) db.close();
}
