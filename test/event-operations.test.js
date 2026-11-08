const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ABC_DATABASE_APPLICATION_ID,
  assertEventEndTimesReady,
  assertAbcDatabase,
  compareEventStatuses,
  createRepositories,
  migrateDatabase,
  openDatabase,
  planEventSync,
  pruneExpiredRegistrations,
  syncEventsFromManifest,
} = require('../src/db');

const projectRoot = path.resolve(__dirname, '..');
const migrationsPath = path.join(projectRoot, 'db', 'migrations');
const operationNow = new Date('2026-09-03T19:00:00.000Z');

function eventFixture(overrides = {}) {
  return {
    id: 'evt_operations_one',
    slug: 'operations-one',
    name: 'Operations Event',
    summary: 'A fixture event for organizer operations.',
    startsAt: '2026-10-10T09:00:00-07:00',
    endsAt: '2026-10-10T12:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Community Center',
    costLabel: 'Free',
    partner: null,
    fundsRaisedCents: null,
    status: 'open',
    capacity: 5,
    registrationOpensAt: null,
    registrationClosesAt: null,
    ...overrides,
  };
}

function setupDatabase(t) {
  const db = openDatabase(':memory:');
  migrateDatabase(db, migrationsPath);
  t.after(() => db.close());
  return db;
}

function registrationFixture(index, overrides = {}) {
  return {
    id: `reg_operations_${index}`,
    contactName: `Registrant ${index}`,
    email: `registrant-${index}@example.com`,
    emailNormalized: `registrant-${index}@example.com`,
    partySize: 1,
    consentVersion: '2026-09-03',
    confirmationCode: `ABC-OPS-${index}`,
    idempotencyKey: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    requestFingerprint: `fingerprint-${index}`,
    ...overrides,
  };
}

test('event-operations migration preserves existing events and registrations', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-event-migration-'));
  const legacyMigrations = path.join(temporaryRoot, 'migrations');
  const databasePath = path.join(temporaryRoot, 'legacy.sqlite');
  fs.mkdirSync(legacyMigrations);
  fs.copyFileSync(
    path.join(migrationsPath, '001_initial.sql'),
    path.join(legacyMigrations, '001_initial.sql')
  );

  const db = openDatabase(databasePath);
  t.after(() => {
    db.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
  migrateDatabase(db, legacyMigrations);
  db.prepare(`
    INSERT INTO events (
      id, slug, name, summary, starts_at, timezone, location_name,
      cost_label, status, capacity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'evt_legacy',
    'legacy-event',
    'Legacy Event',
    'Already in production.',
    '2026-10-10T09:00:00-07:00',
    'America/Phoenix',
    'Legacy Venue',
    'Free',
    'open',
    20
  );
  db.prepare(`
    INSERT INTO registrations (
      id, event_id, contact_name, email, email_normalized, party_size,
      consent_version, confirmation_code, idempotency_key, request_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'reg_legacy',
    'evt_legacy',
    'Legacy Registrant',
    'legacy@example.com',
    'legacy@example.com',
    2,
    '2026-09-03',
    'ABC-LEGACY',
    '00000000-0000-4000-8000-000000000001',
    'legacy-fingerprint'
  );

  migrateDatabase(db, migrationsPath);

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_legacy');
  const registration = db.prepare('SELECT * FROM registrations WHERE id = ?').get('reg_legacy');
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
  const auditTable = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizer_actions'
  `).get();
  const auditForeignKeys = db
    .prepare('PRAGMA foreign_key_list(organizer_actions)')
    .all()
    .map((foreignKey) => foreignKey.table)
    .sort();
  const registrationForeignKey = db
    .prepare('PRAGMA foreign_key_list(organizer_actions)')
    .all()
    .find((foreignKey) => foreignKey.table === 'registrations');
  const auditIndexes = db
    .prepare('PRAGMA index_list(organizer_actions)')
    .all()
    .map((index) => index.name);

  assert.equal(event.name, 'Legacy Event');
  assert.equal(event.ends_at, null);
  assert.equal(registration.party_size, 2);
  assert.ok(eventColumns.includes('ends_at'));
  assert.equal(auditTable.name, 'organizer_actions');
  assert.deepEqual(auditForeignKeys, ['events', 'registrations']);
  assert.equal(registrationForeignKey.on_delete, 'SET NULL');
  assert.ok(auditIndexes.includes('idx_organizer_actions_event_created_at'));
  assert.ok(auditIndexes.includes('idx_organizer_actions_registration_created_at'));
  assert.equal(db.prepare('PRAGMA application_id').get().application_id, ABC_DATABASE_APPLICATION_ID);
  assert.equal(assertAbcDatabase(db), true);
});

test('migration refuses to graft ABC tables into an unrelated database', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY);');

  assert.throws(
    () => migrateDatabase(db, migrationsPath),
    /Database identity mismatch: refusing to modify a non-ABC database/
  );
  assert.deepEqual(
    db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name),
    ['unrelated']
  );
  assert.equal(db.prepare('PRAGMA application_id').get().application_id, 0);
});

test('migration rejects a foreign database with an empty schema migrations table', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-foreign-migrations-'));
  const databasePath = path.join(temporaryRoot, 'foreign.sqlite');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const foreign = openDatabase(databasePath, { configureFile: false });
  foreign.exec(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  foreign.close();
  const before = fs.readFileSync(databasePath);

  const db = openDatabase(databasePath, { configureFile: false });
  assert.throws(
    () => migrateDatabase(db, migrationsPath),
    /Database identity mismatch: refusing to modify a non-ABC database/
  );
  assert.deepEqual(
    db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name),
    ['schema_migrations']
  );
  assert.equal(db.prepare('PRAGMA application_id').get().application_id, 0);
  db.close();

  assert.deepEqual(fs.readFileSync(databasePath), before);
});

test('migration runner rechecks applied state after acquiring the writer lock', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-concurrent-migration-'));
  const migrationDirectory = path.join(temporaryRoot, 'migrations');
  const databasePath = path.join(temporaryRoot, 'concurrent.sqlite');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(
    path.join(migrationDirectory, '001_base.sql'),
    'CREATE TABLE migration_fixture (id INTEGER PRIMARY KEY);\n'
  );
  fs.writeFileSync(
    path.join(migrationDirectory, '002_add_name.sql'),
    'ALTER TABLE migration_fixture ADD COLUMN name TEXT;\n'
  );

  const firstConnection = openDatabase(databasePath);
  const secondConnection = openDatabase(databasePath);
  const actualReadFileSync = fs.readFileSync;
  let secondConnectionMigrated = false;
  t.after(() => {
    fs.readFileSync = actualReadFileSync;
    firstConnection.close();
    secondConnection.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  fs.readFileSync = function readMigrationAndInterleave(filename, ...args) {
    const contents = actualReadFileSync.call(fs, filename, ...args);
    if (!secondConnectionMigrated && path.basename(filename) === '001_base.sql') {
      secondConnectionMigrated = true;
      migrateDatabase(secondConnection, migrationDirectory);
    }
    return contents;
  };

  assert.doesNotThrow(() => migrateDatabase(firstConnection, migrationDirectory));
  fs.readFileSync = actualReadFileSync;

  assert.equal(secondConnectionMigrated, true);
  assert.deepEqual(
    firstConnection
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all()
      .map((row) => row.name),
    ['001_base.sql', '002_add_name.sql']
  );
  assert.deepEqual(
    firstConnection
      .prepare('PRAGMA table_info(migration_fixture)')
      .all()
      .map((column) => column.name),
    ['id', 'name']
  );
});

test('manifest sync updates by stable id without deleting rows or overwriting operational status', (t) => {
  const db = setupDatabase(t);
  const first = eventFixture();
  const retained = eventFixture({
    id: 'evt_retained',
    slug: 'retained-event',
    name: 'Retained Event',
  });
  assert.deepEqual(syncEventsFromManifest(db, [first, retained]), {
    inserted: 2,
    updated: 0,
    unchanged: 0,
    dryRun: false,
  });

  createRepositories(db).events.setStatus(
    first.slug,
    'closed',
    'organizer@example.org',
    'Paused while details are confirmed.',
    operationNow
  );
  const updated = { ...first, name: 'Updated Operations Event', status: 'completed', capacity: 8 };
  const added = eventFixture({
    id: 'evt_added',
    slug: 'added-event',
    name: 'Added Event',
  });

  assert.deepEqual(
    planEventSync(db, [updated, added], { includeDetails: true }).statusDivergences,
    [{
      id: first.id,
      slug: first.slug,
      manifestStatus: 'completed',
      storedStatus: 'closed',
      severity: 'error',
    }]
  );

  assert.deepEqual(syncEventsFromManifest(db, [updated, added]), {
    inserted: 1,
    updated: 1,
    unchanged: 0,
    dryRun: false,
  });
  const stored = db.prepare('SELECT * FROM events WHERE id = ?').get(first.id);
  assert.equal(stored.name, 'Updated Operations Event');
  assert.equal(stored.capacity, 8);
  assert.equal(stored.status, 'closed');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM events').get().total, 3);
  assert.ok(db.prepare('SELECT 1 FROM events WHERE id = ?').get(retained.id));

  assert.deepEqual(syncEventsFromManifest(db, [updated, added]), {
    inserted: 0,
    updated: 0,
    unchanged: 2,
    dryRun: false,
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM events').get().total, 3);
});

test('event status comparison separates operational warnings from publication conflicts', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture();
  syncEventsFromManifest(db, [event]);

  assert.deepEqual(compareEventStatuses(db, [event]), { errors: [], warnings: [] });

  db.prepare('UPDATE events SET status = ? WHERE id = ?').run('closed', event.id);
  assert.deepEqual(compareEventStatuses(db, [event]), {
    errors: [],
    warnings: [{
      code: 'status_mismatch',
      id: event.id,
      slug: event.slug,
      manifestStatus: 'open',
      storedStatus: 'closed',
    }],
  });

  db.prepare('UPDATE events SET status = ? WHERE id = ?').run('open', event.id);
  assert.deepEqual(compareEventStatuses(db, [{ ...event, status: 'closed' }]), {
    errors: [{
      code: 'status_mismatch',
      id: event.id,
      slug: event.slug,
      manifestStatus: 'closed',
      storedStatus: 'open',
    }],
    warnings: [],
  });

  db.prepare('UPDATE events SET status = ? WHERE id = ?').run('closed', event.id);

  const completedManifest = { ...event, status: 'completed' };
  assert.deepEqual(compareEventStatuses(db, [completedManifest]), {
    errors: [{
      code: 'status_mismatch',
      id: event.id,
      slug: event.slug,
      manifestStatus: 'completed',
      storedStatus: 'closed',
    }],
    warnings: [],
  });

  assert.deepEqual(compareEventStatuses(db, []), {
    errors: [{
      code: 'missing_manifest_event',
      id: event.id,
      slug: event.slug,
      manifestStatus: null,
      storedStatus: 'closed',
    }],
    warnings: [],
  });
});

test('manifest sync dry runs and validation failures are atomic', (t) => {
  const db = setupDatabase(t);
  const first = eventFixture();
  const second = eventFixture({ id: 'evt_operations_two', slug: 'operations-two' });
  syncEventsFromManifest(db, [first, second]);

  const proposed = { ...first, name: 'Dry-run Name' };
  const proposedNew = eventFixture({ id: 'evt_dry_run', slug: 'dry-run-event' });
  assert.deepEqual(syncEventsFromManifest(db, [proposed, proposedNew], { dryRun: true }), {
    inserted: 1,
    updated: 1,
    unchanged: 0,
    dryRun: true,
  });
  assert.equal(db.prepare('SELECT name FROM events WHERE id = ?').get(first.id).name, first.name);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM events').get().total, 2);

  db.exec('BEGIN;');
  try {
    assert.deepEqual(planEventSync(db, [proposed, proposedNew]), {
      inserted: 1,
      updated: 1,
      unchanged: 0,
    });
    assert.deepEqual(
      planEventSync(db, [proposed, proposedNew], { includeDetails: true }).changes,
      [
        {
          type: 'update',
          id: first.id,
          slug: first.slug,
          fields: ['name'],
        },
        {
          type: 'insert',
          id: proposedNew.id,
          slug: proposedNew.slug,
          fields: ['new event'],
        },
      ]
    );
    assert.deepEqual(syncEventsFromManifest(db, [proposed, proposedNew], { dryRun: true }), {
      inserted: 1,
      updated: 1,
      unchanged: 0,
      dryRun: true,
    });
  } finally {
    db.exec('ROLLBACK;');
  }

  assert.throws(
    () => syncEventsFromManifest(db, [proposed, { ...second, slug: 'changed-slug' }]),
    /Cannot change slug/
  );
  assert.equal(db.prepare('SELECT name FROM events WHERE id = ?').get(first.id).name, first.name);

  assert.throws(
    () => syncEventsFromManifest(db, [
      first,
      eventFixture({ id: 'evt_collision', slug: first.slug }),
    ]),
    /duplicate slug|already belongs/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM events').get().total, 2);
});

test('manifest sync atomically rejects capacity below confirmed attendance', (t) => {
  const db = setupDatabase(t);
  const first = eventFixture();
  const second = eventFixture({
    id: 'evt_capacity_guard',
    slug: 'capacity-guard',
    name: 'Capacity Guard Event',
  });
  syncEventsFromManifest(db, [first, second]);
  createRepositories(db).registrations.createForEvent(
    second.slug,
    registrationFixture(5, { partySize: 3 }),
    operationNow
  );

  assert.throws(
    () => syncEventsFromManifest(db, [
      { ...first, name: 'This update must roll back' },
      { ...second, capacity: 2 },
    ]),
    /Cannot reduce capacity.*3 spots are already confirmed/
  );

  assert.equal(db.prepare('SELECT name FROM events WHERE id = ?').get(first.id).name, first.name);
  assert.equal(db.prepare('SELECT capacity FROM events WHERE id = ?').get(second.id).capacity, 5);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS total FROM registrations').get().total,
    1
  );
});

test('registration summaries and cancellation release capacity exactly once', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture();
  syncEventsFromManifest(db, [event]);
  const repositories = createRepositories(db);
  repositories.registrations.createForEvent(
    event.slug,
    registrationFixture(1, { partySize: 2 }),
    operationNow
  );
  repositories.registrations.createForEvent(
    event.slug,
    registrationFixture(2),
    operationNow
  );

  assert.deepEqual(repositories.registrations.summaryForEvent(event.slug, operationNow), {
    event_id: event.id,
    event_slug: event.slug,
    event_name: event.name,
    stored_event_status: 'open',
    capacity: 5,
    total_registrations: 2,
    confirmed_registrations: 2,
    cancelled_registrations: 0,
    confirmed_spots: 3,
    cancelled_spots: 0,
    event_status: 'open',
    remaining: 2,
  });
  const listed = repositories.registrations.listForEvent(event.slug);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].contact_name, 'Registrant 1');

  const firstCancellation = repositories.registrations.cancelByConfirmationCode(
    'ABC-OPS-1',
    'organizer@example.org',
    'Registrant asked to cancel.',
    operationNow
  );
  const replayedCancellation = repositories.registrations.cancelByConfirmationCode(
    'ABC-OPS-1',
    'organizer@example.org',
    'Repeated command.',
    operationNow
  );

  assert.equal(firstCancellation.changed, true);
  assert.equal(firstCancellation.registration.status, 'cancelled');
  assert.equal(replayedCancellation.changed, false);
  assert.deepEqual(repositories.registrations.summaryForEvent(event.slug, operationNow), {
    event_id: event.id,
    event_slug: event.slug,
    event_name: event.name,
    stored_event_status: 'open',
    capacity: 5,
    total_registrations: 2,
    confirmed_registrations: 1,
    cancelled_registrations: 1,
    confirmed_spots: 1,
    cancelled_spots: 2,
    event_status: 'open',
    remaining: 4,
  });
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS total FROM organizer_actions
      WHERE action = 'registration.cancelled'
    `).get().total,
    1
  );
});

test('event status changes enforce legal, time-aware, terminal transitions', (t) => {
  const db = setupDatabase(t);
  const publishableDraft = eventFixture({ status: 'draft' });
  const incompleteDraft = eventFixture({
    id: 'evt_incomplete_draft',
    slug: 'incomplete-draft',
    status: 'draft',
    endsAt: null,
  });
  const cancellable = eventFixture({
    id: 'evt_cancellable',
    slug: 'cancellable-event',
  });
  syncEventsFromManifest(db, [publishableDraft, incompleteDraft, cancellable]);
  const repositories = createRepositories(db);

  assert.equal(
    repositories.events.setStatus(
      publishableDraft.slug,
      'open',
      'organizer@example.org',
      'Publishing reviewed event details.',
      operationNow
    ).event.status,
    'open'
  );
  assert.equal(
    repositories.events.setStatus(
      publishableDraft.slug,
      'closed',
      'organizer@example.org',
      'Registration is closed.',
      operationNow
    ).event.status,
    'closed'
  );
  assert.throws(
    () => repositories.events.setStatus(
      publishableDraft.slug,
      'open',
      'organizer@example.org',
      'Attempted reopening.',
      operationNow
    ),
    /Cannot transition.*closed.*open/
  );
  assert.throws(
    () => repositories.events.setStatus(
      publishableDraft.slug,
      'completed',
      'organizer@example.org',
      'Attempted early completion.',
      operationNow
    ),
    /before its end time/
  );
  assert.equal(
    repositories.events.setStatus(
      publishableDraft.slug,
      'completed',
      'organizer@example.org',
      'Event has ended.',
      new Date('2026-10-10T20:00:00.000Z')
    ).event.status,
    'completed'
  );
  assert.throws(
    () => repositories.events.setStatus(
      publishableDraft.slug,
      'cancelled',
      'organizer@example.org',
      'Attempted terminal reversal.',
      new Date('2026-10-10T20:00:00.000Z')
    ),
    /Cannot transition.*completed.*cancelled/
  );
  assert.throws(
    () => repositories.events.setStatus(
      incompleteDraft.slug,
      'open',
      'organizer@example.org',
      'Missing end time.',
      operationNow
    ),
    /start and end times are in the future/
  );
  assert.throws(
    () => repositories.events.setStatus(
      incompleteDraft.slug,
      'cancelled',
      'organizer@example.org',
      'Draft will not proceed.',
      operationNow
    ),
    /Cannot transition.*draft.*cancelled/
  );
  assert.equal(
    repositories.events.setStatus(
      cancellable.slug,
      'cancelled',
      'organizer@example.org',
      'Event was cancelled.',
      operationNow
    ).event.status,
    'cancelled'
  );
  assert.throws(
    () => repositories.events.setStatus(
      cancellable.slug,
      'not-a-status',
      'organizer@example.org',
      'Unsupported target.',
      operationNow
    ),
    /Unsupported event status/
  );
});

test('cancelled events cannot be resurfaced by transition or registration replay', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture();
  syncEventsFromManifest(db, [event]);
  const repositories = createRepositories(db);
  const registration = registrationFixture(6);
  repositories.registrations.createForEvent(event.slug, registration, operationNow);

  repositories.events.setStatus(
    event.slug,
    'closed',
    'organizer@example.org',
    'Registration is closed.',
    operationNow
  );
  const cancellation = repositories.events.setStatus(
    event.slug,
    'cancelled',
    'organizer@example.org',
    'Event was cancelled.',
    operationNow
  );
  const repeatedCancellation = repositories.events.setStatus(
    event.slug,
    'cancelled',
    'organizer@example.org',
    'Repeated cancellation.',
    operationNow
  );
  assert.equal(cancellation.changed, true);
  assert.equal(repeatedCancellation.changed, false);
  assert.throws(
    () => repositories.events.setStatus(
      event.slug,
      'closed',
      'organizer@example.org',
      'Attempted reversal.',
      operationNow
    ),
    /Cannot transition.*cancelled.*closed/
  );
  assert.equal(repositories.registrations.findExactReplay(event.slug, registration).status, 'cancelled');

  const audits = db.prepare(`
    SELECT previous_status, next_status
    FROM organizer_actions
    WHERE action = 'event.status_changed'
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(audits, [
    { previous_status: 'open', next_status: 'closed' },
    { previous_status: 'closed', next_status: 'cancelled' },
  ]);
});

test('organizer summaries expose stored and effective status after an event ends', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture({
    startsAt: '2026-09-01T09:00:00-07:00',
    endsAt: '2026-09-01T12:00:00-07:00',
  });
  syncEventsFromManifest(db, [event]);

  assert.throws(
    () => createRepositories(db).events.setStatus(
      event.slug,
      'cancelled',
      'organizer@example.org',
      'Event was cancelled.',
      operationNow
    ),
    /after it has ended; mark it completed/
  );

  const summary = createRepositories(db).registrations.summaryForEvent(event.slug, operationNow);
  assert.equal(summary.stored_event_status, 'open');
  assert.equal(summary.event_status, 'completed');

  db.prepare('UPDATE events SET ends_at = NULL WHERE id = ?').run(event.id);
  const legacySummary = createRepositories(db).registrations.summaryForEvent(
    event.slug,
    operationNow
  );
  assert.equal(legacySummary.stored_event_status, 'open');
  assert.equal(legacySummary.event_status, 'completed');
});

test('future public database-only events cannot run without an end time', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture({ endsAt: null });
  syncEventsFromManifest(db, [event]);

  assert.throws(
    () => assertEventEndTimesReady(db, operationNow),
    /Future public events require ends_at.*operations-one/
  );
  db.prepare("UPDATE events SET status = 'draft' WHERE id = ?").run(event.id);
  assert.equal(assertEventEndTimesReady(db, operationNow), true);
});

test('event changes, cancellations, and explicit records create PII-free audit rows', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture();
  syncEventsFromManifest(db, [event]);
  const repositories = createRepositories(db);
  repositories.registrations.createForEvent(
    event.slug,
    registrationFixture(3),
    operationNow
  );

  const statusChange = repositories.events.setStatus(
    event.slug,
    'closed',
    'organizer@example.org',
    'Registration window ended.',
    operationNow
  );
  const duplicateStatusChange = repositories.events.setStatus(
    event.slug,
    'closed',
    'organizer@example.org',
    'Repeated command.',
    operationNow
  );
  repositories.registrations.cancelByConfirmationCode(
    'ABC-OPS-3',
    'organizer@example.org',
    'Cancelled by organizer.',
    operationNow
  );
  const exportAudit = repositories.audit.record({
    action: 'registrations.exported',
    actor: 'organizer@example.org',
    eventId: event.id,
    details: { format: 'csv', recordCount: 1 },
    now: operationNow,
  });

  assert.equal(statusChange.changed, true);
  assert.equal(duplicateStatusChange.changed, false);
  assert.equal(exportAudit.action, 'registrations.exported');
  assert.equal(exportAudit.details_json, '{"format":"csv","recordCount":1}');

  const auditRows = db.prepare('SELECT * FROM organizer_actions ORDER BY id').all();
  assert.equal(auditRows.length, 3);
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ['event.status_changed', 'registration.cancelled', 'registrations.exported']
  );
  assert.equal(auditRows[0].previous_status, 'open');
  assert.equal(auditRows[0].next_status, 'closed');
  assert.equal(auditRows[1].registration_id, 'reg_operations_3');

  const serializedAudit = JSON.stringify(auditRows);
  assert.equal(serializedAudit.includes('Registrant 3'), false);
  assert.equal(serializedAudit.includes('registrant-3@example.com'), false);
  assert.equal(serializedAudit.includes('ABC-OPS-3'), false);
});

test('registration retention uses an event end time when available', (t) => {
  const db = setupDatabase(t);
  const event = eventFixture();
  syncEventsFromManifest(db, [event]);
  const repositories = createRepositories(db);
  repositories.registrations.createForEvent(
    event.slug,
    registrationFixture(4),
    operationNow
  );

  db.prepare(`
    UPDATE events
    SET starts_at = ?, ends_at = ?, status = 'completed'
    WHERE id = ?
  `).run('2026-07-01T09:00:00Z', '2026-08-20T09:00:00Z', event.id);
  assert.equal(pruneExpiredRegistrations(db, operationNow, 30), 0);

  db.prepare('UPDATE events SET ends_at = ? WHERE id = ?')
    .run('2026-07-01T12:00:00Z', event.id);
  repositories.registrations.cancelByConfirmationCode(
    'ABC-OPS-4',
    'organizer@example.org',
    'Retention test cancellation.',
    operationNow
  );
  assert.equal(pruneExpiredRegistrations(db, operationNow, 30), 1);
  const retainedAudit = db.prepare(`
    SELECT action, registration_id
    FROM organizer_actions
    WHERE action = 'registration.cancelled'
  `).get();
  assert.equal(retainedAudit.action, 'registration.cancelled');
  assert.equal(retainedAudit.registration_id, null);
});
