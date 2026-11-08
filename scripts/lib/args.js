function parseArgs(argv, { allowed = [], booleans = [] } = {}) {
  const booleanNames = new Set(booleans);
  const allowedNames = new Set([...allowed, ...booleans]);
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token.length === 2) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (!allowedNames.has(name)) throw new Error(`Unknown argument: --${name}.`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: --${name}`);

    if (booleanNames.has(name)) {
      values[name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}.`);
    }
    values[name] = value;
    index += 1;
  }

  return values;
}

function requiredArg(args, name) {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`Missing required argument: --${name}.`);
  return value;
}

function printError(error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}

module.exports = { parseArgs, printError, requiredArg };
