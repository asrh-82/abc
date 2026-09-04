process.umask(0o077);

const { parseArgs, printError, requiredArg } = require('./lib/args');
const { openOrganizerDatabase, printDatabasePath } = require('./lib/database');

let db;
try {
  const args = parseArgs(process.argv.slice(2), { allowed: ['event'] });
  const slug = requiredArg(args, 'event');
  printDatabasePath();
  let repositories;
  ({ db, repositories } = openOrganizerDatabase());
  const summary = repositories.registrations.summaryForEvent(slug);
  if (!summary) throw new Error(`Event not found: ${slug}`);

  console.log(`Event: ${summary.event_name} (${summary.event_slug})`);
  console.log(`Status: ${summary.event_status}`);
  console.log(`Confirmed registrations: ${summary.confirmed_registrations}`);
  console.log(`Confirmed spots: ${summary.confirmed_spots}`);
  console.log(`Cancelled registrations: ${summary.cancelled_registrations}`);
  console.log(`Capacity: ${summary.capacity === null ? 'Unlimited' : summary.capacity}`);
  console.log(`Remaining: ${summary.remaining === null ? 'Unlimited' : summary.remaining}`);
} catch (error) {
  printError(error);
} finally {
  if (db) db.close();
}
