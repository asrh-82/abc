process.umask(0o077);

const { validateActor, validateReason } = require('../src/organizer');
const { parseArgs, printError, requiredArg } = require('./lib/args');
const { openOrganizerDatabase, printDatabasePath } = require('./lib/database');

let db;
try {
  const args = parseArgs(process.argv.slice(2), {
    allowed: ['code', 'actor', 'reason'],
  });
  const code = requiredArg(args, 'code');
  const actor = validateActor(requiredArg(args, 'actor'));
  const reason = validateReason(requiredArg(args, 'reason'));
  printDatabasePath();
  let repositories;
  ({ db, repositories } = openOrganizerDatabase());
  const result = repositories.registrations.cancelByConfirmationCode(
    code,
    actor,
    reason,
    new Date()
  );
  if (!result) throw new Error('Registration not found.');
  console.log(
    result.changed
      ? 'Registration cancelled; its spots are available again.'
      : 'Registration was already cancelled; nothing changed.'
  );
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
