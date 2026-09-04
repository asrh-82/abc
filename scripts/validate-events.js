process.umask(0o077);

const config = require('../src/config');
const { loadEventManifest } = require('../src/event-manifest');
const { parseArgs, printError } = require('./lib/args');

try {
  parseArgs(process.argv.slice(2));
  const events = loadEventManifest(config.eventManifestPath);
  console.log(`Validated ${events.length} event record${events.length === 1 ? '' : 's'}.`);
} catch (error) {
  printError(error);
}
