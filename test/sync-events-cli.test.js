const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { loadEventManifest } = require('../src/event-manifest');
const { migrateDatabase, openDatabase, syncEventsFromManifest } = require('../src/db');

const projectRoot = path.resolve(__dirname, '..');
const syncScript = path.join(projectRoot, 'scripts', 'sync-events.js');
const statusCheckScript = path.join(projectRoot, 'scripts', 'check-event-statuses.js');
const eventStatusScript = path.join(projectRoot, 'scripts', 'event-status.js');
const pruneScript = path.join(projectRoot, 'scripts', 'prune-registrations.js');
const summaryScript = path.join(projectRoot, 'scripts', 'registration-summary.js');
const migrationsPath = path.join(projectRoot, 'db', 'migrations');

function runDrySync(databasePath) {
  return spawnSync(process.execPath, [syncScript, '--dry-run'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: databasePath },
  });
}

function runStatusCheck(databasePath) {
  return spawnSync(process.execPath, [statusCheckScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: databasePath },
  });
}

test('event sync dry-run never creates a missing database', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-sync-missing-'));
  const databasePath = path.join(directory, 'missing.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = runDrySync(databasePath);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ABC database does not exist/);
  assert.equal(fs.existsSync(databasePath), false);
});

test('event sync dry-run is read-only and identifies exact proposed events', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-sync-readonly-'));
  const databasePath = path.join(directory, 'abc.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const db = openDatabase(databasePath);
  migrateDatabase(db, migrationsPath);
  const events = loadEventManifest(path.join(projectRoot, 'data', 'events.json'), {
    now: new Date('2026-09-04T12:00:00Z'),
  });
  syncEventsFromManifest(db, events.slice(0, 2));
  db.close();
  const before = fs.readFileSync(databasePath);

  const result = runDrySync(databasePath);
  const after = fs.readFileSync(databasePath);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run: 1 inserted, 0 updated, 2 unchanged/);
  assert.match(
    result.stdout,
    /insert evt_tennis_2026 \(community-tennis-tournament\): new event/
  );
  assert.deepEqual(after, before);
});

test('event status check is read-only and rejects publication-significant drift', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-status-check-'));
  const databasePath = path.join(directory, 'abc.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const db = openDatabase(databasePath);
  migrateDatabase(db, migrationsPath);
  const events = loadEventManifest(path.join(projectRoot, 'data', 'events.json'));
  syncEventsFromManifest(db, events);
  db.close();

  const aligned = runStatusCheck(databasePath);
  assert.equal(aligned.status, 0, aligned.stderr);
  assert.match(aligned.stdout, new RegExp(`Database: ${databasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(aligned.stdout, /statuses are aligned/);

  const mutation = openDatabase(databasePath);
  mutation.prepare('UPDATE events SET status = ? WHERE id = ?').run(
    'cancelled',
    events[0].id
  );
  mutation.close();
  const before = fs.readFileSync(databasePath);
  const drifted = runStatusCheck(databasePath);
  const after = fs.readFileSync(databasePath);

  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /manifest=completed and database=cancelled/);
  assert.match(drifted.stderr, /consistency check failed/);
  assert.deepEqual(after, before);
});

test('event status command identifies its database and states that it is local-only', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-event-status-cli-'));
  const databasePath = path.join(directory, 'abc.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const db = openDatabase(databasePath);
  migrateDatabase(db, migrationsPath);
  syncEventsFromManifest(db, [{
    id: 'evt_cli_draft',
    slug: 'cli-draft-event',
    name: 'CLI Draft Event',
    summary: 'A future event for the status command test.',
    startsAt: '2035-10-20T09:00:00-07:00',
    endsAt: '2035-10-20T12:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Phoenix, Arizona',
    costLabel: 'Free',
    partner: null,
    fundsRaisedCents: null,
    status: 'draft',
    capacity: 10,
    registrationOpensAt: null,
    registrationClosesAt: null,
  }]);
  db.close();

  const result = spawnSync(process.execPath, [
    eventStatusScript,
    '--event', 'cli-draft-event',
    '--status', 'open',
    '--actor', 'abc-operations',
    '--reason', 'event-approved',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: databasePath },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith(`Database: ${databasePath}\n`));
  assert.match(result.stdout, /Event cli-draft-event is now open/);
  assert.match(result.stdout, /only the local registration database/);
  assert.match(result.stdout, /does not update data\/events\.json or deploy Vercel/);

  const check = openDatabase(databasePath, { readOnly: true, configureFile: false });
  assert.equal(
    check.prepare('SELECT status FROM events WHERE id = ?').get('evt_cli_draft').status,
    'open'
  );
  check.close();
});

test('prune rejects a fake dry run flag before deleting eligible registrations', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-prune-args-'));
  const databasePath = path.join(directory, 'abc.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const db = openDatabase(databasePath);
  migrateDatabase(db, migrationsPath);
  const events = loadEventManifest(path.join(projectRoot, 'data', 'events.json'));
  syncEventsFromManifest(db, events);
  db.prepare(`
    INSERT INTO registrations (
      id, event_id, contact_name, email, email_normalized, party_size,
      consent_version, confirmation_code, idempotency_key, request_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'reg_prune_cli',
    events[0].id,
    'Prune Test',
    'prune-test@example.com',
    'prune-test@example.com',
    1,
    '2026-09-03',
    'ABC-PRUNE-CLI',
    '00000000-0000-4000-8000-000000000099',
    'prune-cli-fingerprint'
  );
  db.close();

  const result = spawnSync(process.execPath, [pruneScript, '--dry-run'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: databasePath },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: --dry-run/);
  assert.equal(result.stdout, '');

  const check = openDatabase(databasePath, { readOnly: true, configureFile: false });
  assert.equal(check.prepare('SELECT COUNT(*) AS total FROM registrations').get().total, 1);
  check.close();
});

test('organizer commands reject an unrelated database without modifying it', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-wrong-database-'));
  const databasePath = path.join(directory, 'unrelated.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY);');
  db.close();
  const before = fs.readFileSync(databasePath);

  const result = spawnSync(
    process.execPath,
    [summaryScript, '--event', 'community-tennis-tournament'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: databasePath },
    }
  );
  const after = fs.readFileSync(databasePath);
  const check = new DatabaseSync(databasePath, { readOnly: true });
  const tables = check.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name);
  const applicationId = check.prepare('PRAGMA application_id').get().application_id;
  check.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Database identity mismatch/);
  assert.deepEqual(tables, ['unrelated']);
  assert.equal(applicationId, 0);
  assert.deepEqual(after, before);
});
