process.umask(0o077);

const { validateActor, validateEventStatus, validateReason } = require('../src/organizer');
const { parseArgs, printError, requiredArg } = require('./lib/args');
const { openOrganizerDatabase, printDatabasePath } = require('./lib/database');

let db;
try {
  const args = parseArgs(process.argv.slice(2), {
    allowed: ['event', 'status', 'actor', 'reason'],
  });
  const slug = requiredArg(args, 'event');
  const status = validateEventStatus(requiredArg(args, 'status'));
  const actor = validateActor(requiredArg(args, 'actor'));
  const reason = validateReason(requiredArg(args, 'reason'));
  printDatabasePath();
  let repositories;
  ({ db, repositories } = openOrganizerDatabase());
  const result = repositories.events.setStatus(slug, status, actor, reason, new Date());
  if (!result) throw new Error(`Event not found: ${slug}`);
  console.log(
    result.changed
      ? `Event ${slug} is now ${status}.`
      : `Event ${slug} was already ${status}; nothing changed.`
  );
  if (result.changed) {
    console.log(
      'This changes only the local registration database; it does not update ' +
      'data/events.json or deploy Vercel.'
    );
    console.log(
      `Mirror "${status}" in data/events.json, then run npm run events:status-check ` +
      'before publishing a Vercel preview.'
    );
  }
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
