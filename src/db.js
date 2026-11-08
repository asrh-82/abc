const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ABC_DATABASE_APPLICATION_ID = 1094861617;

const EVENT_COLUMNS = `
  e.id,
  e.slug,
  e.name,
  e.summary,
  e.starts_at,
  e.ends_at,
  e.timezone,
  e.location_name,
  e.cost_label,
  e.partner,
  e.funds_raised_cents,
  e.status,
  e.capacity,
  e.registration_opens_at,
  e.registration_closes_at,
  e.created_at,
  e.updated_at,
  COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0) AS reserved
`;

function configureDatabaseFile(db, filename) {
  if (filename === ':memory:') return;
  db.exec('PRAGMA journal_mode = WAL;');
  for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
  }
}

function openDatabase(
  filename,
  { configureFile = true, existingOnly = false, readOnly = false } = {}
) {
  if (filename !== ':memory:') {
    if (existingOnly && !fs.existsSync(filename)) {
      throw new Error(`ABC database does not exist at ${filename}. Run npm run db:migrate first.`);
    }
    if (!readOnly) fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(filename, { readOnly });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (configureFile && !readOnly) configureDatabaseFile(db, filename);
  return db;
}

function databaseMigrationIdentity(db) {
  const applicationId = db.prepare('PRAGMA application_id').get().application_id;
  if (applicationId === ABC_DATABASE_APPLICATION_ID) return 'abc';
  const tables = new Set(
    db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all().map((row) => row.name)
  );
  if (tables.size === 0) return 'empty';
  if (
    applicationId === 0 &&
    tables.size === 3 &&
    tables.has('events') &&
    tables.has('registrations') &&
    tables.has('schema_migrations')
  ) {
    const initialMigration = db.prepare(
      "SELECT 1 FROM schema_migrations WHERE name = '001_initial.sql'"
    ).get();
    if (initialMigration) return 'legacy-abc';
  }
  throw new Error('Database identity mismatch: refusing to modify a non-ABC database.');
}

function migrateDatabase(db, migrationsPath) {
  // Reserve a genuinely empty database for ABC while holding the writer lock.
  // A concurrent migrator can then recognize the application ID, while a
  // foreign database that merely has its own schema_migrations table is never
  // mistaken for an empty ABC database.
  db.exec('BEGIN IMMEDIATE;');
  try {
    const identity = databaseMigrationIdentity(db);
    if (identity === 'empty' || identity === 'legacy-abc') {
      db.exec(`PRAGMA application_id = ${ABC_DATABASE_APPLICATION_ID};`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const migrationFiles = fs
    .readdirSync(migrationsPath)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const findAppliedMigration = db.prepare(
    'SELECT name FROM schema_migrations WHERE name = ?'
  );
  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (name) VALUES (?)'
  );

  for (const name of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsPath, name), 'utf8');

    // BEGIN IMMEDIATE serializes migration writers. The applied-state check must
    // happen after acquiring that lock so a connection never acts on a stale
    // snapshot after another process has completed the same migration.
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (findAppliedMigration.get(name)) {
        db.exec('COMMIT;');
        continue;
      }
      db.exec(sql);
      recordMigration.run(name);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}

function assertAbcDatabase(db) {
  const row = db.prepare('PRAGMA application_id').get();
  if (row.application_id !== ABC_DATABASE_APPLICATION_ID) {
    throw new Error('Database identity mismatch: expected an Autism: Bringing Change database.');
  }
  return true;
}

const EVENT_SYNC_MUTABLE_FIELDS = [
  ['name', 'name'],
  ['summary', 'summary'],
  ['starts_at', 'startsAt'],
  ['ends_at', 'endsAt'],
  ['timezone', 'timezone'],
  ['location_name', 'locationName'],
  ['cost_label', 'costLabel'],
  ['partner', 'partner'],
  ['funds_raised_cents', 'fundsRaisedCents'],
  ['capacity', 'capacity'],
  ['registration_opens_at', 'registrationOpensAt'],
  ['registration_closes_at', 'registrationClosesAt'],
];

function manifestValue(event, key) {
  return event[key] ?? null;
}

function buildEventSyncPlan(db, events) {
  if (!Array.isArray(events)) {
    throw new TypeError('Event manifest must be an array.');
  }

  const existingRows = db.prepare(`
    SELECT
      e.*,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0)
        AS confirmed_spots
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    GROUP BY e.id
  `).all();
  const existingById = new Map(existingRows.map((event) => [event.id, event]));
  const existingBySlug = new Map(existingRows.map((event) => [event.slug, event]));
  const manifestIds = new Set();
  const manifestSlugs = new Set();

  for (const event of events) {
    if (manifestIds.has(event.id)) {
      throw new Error(`Event manifest contains duplicate id "${event.id}".`);
    }
    if (manifestSlugs.has(event.slug)) {
      throw new Error(`Event manifest contains duplicate slug "${event.slug}".`);
    }
    manifestIds.add(event.id);
    manifestSlugs.add(event.slug);

    const existingByStableId = existingById.get(event.id);
    if (existingByStableId && existingByStableId.slug !== event.slug) {
      throw new Error(
        `Cannot change slug for event "${event.id}" from "${existingByStableId.slug}" to "${event.slug}".`
      );
    }

    const existingWithSlug = existingBySlug.get(event.slug);
    if (existingWithSlug && existingWithSlug.id !== event.id) {
      throw new Error(
        `Event slug "${event.slug}" already belongs to event "${existingWithSlug.id}".`
      );
    }
  }

  const changes = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const statusDivergences = [];

  for (const event of events) {
    const existing = existingById.get(event.id);
    if (!existing) {
      inserted += 1;
      changes.push({ type: 'insert', event, fields: ['new event'] });
      continue;
    }

    if (existing.status !== event.status) {
      statusDivergences.push({
        id: event.id,
        slug: event.slug,
        manifestStatus: event.status,
        storedStatus: existing.status,
        severity: eventStatusDifferenceSeverity(event.status, existing.status),
      });
    }

    const proposedCapacity = manifestValue(event, 'capacity');
    if (proposedCapacity !== null && proposedCapacity < existing.confirmed_spots) {
      throw new Error(
        `Cannot reduce capacity for event "${event.slug}" to ${proposedCapacity}; ` +
        `${existing.confirmed_spots} spots are already confirmed.`
      );
    }

    const changedFields = EVENT_SYNC_MUTABLE_FIELDS
      .filter(([column, key]) => existing[column] !== manifestValue(event, key))
      .map(([, key]) => key);
    if (changedFields.length === 0) {
      unchanged += 1;
      continue;
    }

    updated += 1;
    changes.push({ type: 'update', event, fields: changedFields });
  }

  return {
    summary: { inserted, updated, unchanged },
    changes,
    statusDivergences,
  };
}

function eventStatusDifferenceSeverity(manifestStatus, storedStatus) {
  return manifestStatus === 'open' && storedStatus === 'closed'
    ? 'warning'
    : 'error';
}

function compareEventStatuses(db, events) {
  if (!Array.isArray(events)) throw new TypeError('Event manifest must be an array.');

  const storedEvents = db.prepare('SELECT id, slug, status FROM events ORDER BY id').all();
  const storedById = new Map(storedEvents.map((event) => [event.id, event]));
  const manifestById = new Map(events.map((event) => [event.id, event]));
  const errors = [];
  const warnings = [];

  for (const event of events) {
    const stored = storedById.get(event.id);
    if (!stored) {
      errors.push({
        code: 'missing_database_event',
        id: event.id,
        slug: event.slug,
        manifestStatus: event.status,
        storedStatus: null,
      });
      continue;
    }
    if (stored.slug !== event.slug) {
      errors.push({
        code: 'slug_mismatch',
        id: event.id,
        slug: event.slug,
        storedSlug: stored.slug,
        manifestStatus: event.status,
        storedStatus: stored.status,
      });
      continue;
    }
    if (stored.status === event.status) continue;

    const difference = {
      code: 'status_mismatch',
      id: event.id,
      slug: event.slug,
      manifestStatus: event.status,
      storedStatus: stored.status,
    };
    if (eventStatusDifferenceSeverity(event.status, stored.status) === 'warning') {
      warnings.push(difference);
    } else {
      errors.push(difference);
    }
  }

  for (const stored of storedEvents) {
    if (manifestById.has(stored.id)) continue;
    errors.push({
      code: 'missing_manifest_event',
      id: stored.id,
      slug: stored.slug,
      manifestStatus: null,
      storedStatus: stored.status,
    });
  }

  return { errors, warnings };
}

function planEventSync(db, events, { includeDetails = false } = {}) {
  const plan = buildEventSyncPlan(db, events);
  if (!includeDetails) return plan.summary;
  return {
    ...plan.summary,
    changes: plan.changes.map(({ type, event, fields }) => ({
      type,
      id: event.id,
      slug: event.slug,
      fields,
    })),
    statusDivergences: plan.statusDivergences,
  };
}

function syncEventsFromManifest(
  db,
  events,
  { dryRun = false, includeDetails = false } = {}
) {
  if (dryRun) {
    return { ...planEventSync(db, events, { includeDetails }), dryRun: true };
  }

  const insert = db.prepare(`
    INSERT INTO events (
      id, slug, name, summary, starts_at, ends_at, timezone, location_name,
      cost_label, partner, funds_raised_cents, status, capacity,
      registration_opens_at, registration_closes_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE events
    SET
      name = ?,
      summary = ?,
      starts_at = ?,
      ends_at = ?,
      timezone = ?,
      location_name = ?,
      cost_label = ?,
      partner = ?,
      funds_raised_cents = ?,
      capacity = ?,
      registration_opens_at = ?,
      registration_closes_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    const { summary, changes, statusDivergences } = buildEventSyncPlan(db, events);
    for (const change of changes) {
      const { event } = change;
      if (change.type === 'insert') {
        insert.run(
          event.id,
          event.slug,
          event.name,
          event.summary,
          event.startsAt,
          manifestValue(event, 'endsAt'),
          event.timezone,
          event.locationName,
          event.costLabel,
          manifestValue(event, 'partner'),
          manifestValue(event, 'fundsRaisedCents'),
          event.status,
          manifestValue(event, 'capacity'),
          manifestValue(event, 'registrationOpensAt'),
          manifestValue(event, 'registrationClosesAt')
        );
      } else {
        update.run(
          event.name,
          event.summary,
          event.startsAt,
          manifestValue(event, 'endsAt'),
          event.timezone,
          event.locationName,
          event.costLabel,
          manifestValue(event, 'partner'),
          manifestValue(event, 'fundsRaisedCents'),
          manifestValue(event, 'capacity'),
          manifestValue(event, 'registrationOpensAt'),
          manifestValue(event, 'registrationClosesAt'),
          event.id
        );
      }
    }

    db.exec('COMMIT;');
    const result = { ...summary, dryRun: false };
    if (includeDetails) {
      result.changes = changes.map(({ type, event, fields }) => ({
        type,
        id: event.id,
        slug: event.slug,
        fields,
      }));
      result.statusDivergences = statusDivergences;
    }
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function pruneExpiredRegistrations(db, now, retentionDays) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error('REGISTRATION_RETENTION_DAYS must be an integer between 1 and 365.');
  }
  const threshold = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    DELETE FROM registrations
    WHERE event_id IN (
      SELECT id FROM events
      WHERE datetime(COALESCE(ends_at, starts_at)) < datetime(?)
    )
  `).run(threshold);
  return Number(result.changes);
}

function assertEventEndTimesReady(db, now = new Date()) {
  const nowValue = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowValue.getTime())) throw new TypeError('now must be a valid date.');
  const blocked = db.prepare(`
    SELECT slug, starts_at
    FROM events
    WHERE ends_at IS NULL
      AND status IN ('open', 'closed')
  `).all().filter((event) => {
    const startsAt = Date.parse(event.starts_at);
    return !Number.isFinite(startsAt) || startsAt >= nowValue.getTime();
  });
  if (blocked.length > 0) {
    throw new Error(
      'Future public events require ends_at before the server can start: ' +
      blocked.map((event) => event.slug).join(', ')
    );
  }
  return true;
}

function createRepositories(db) {
  const listEventsStatement = db.prepare(`
    SELECT ${EVENT_COLUMNS}
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.status != 'draft'
    GROUP BY e.id
    ORDER BY e.starts_at ASC
  `);
  const findEventStatement = db.prepare(`
    SELECT ${EVENT_COLUMNS}
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.slug = ? AND e.status != 'draft'
    GROUP BY e.id
  `);
  const findRawEventStatement = db.prepare('SELECT * FROM events WHERE slug = ?');
  const findIdempotentStatement = db.prepare(
    'SELECT * FROM registrations WHERE event_id = ? AND idempotency_key = ?'
  );
  const findConfirmationStatement = db.prepare(`
    SELECT
      r.id,
      r.confirmation_code,
      r.party_size,
      r.status,
      r.created_at,
      e.slug AS event_slug,
      e.name AS event_name,
      e.starts_at,
      e.ends_at,
      e.timezone,
      e.location_name,
      e.cost_label,
      e.status AS event_status
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    WHERE r.confirmation_code = ?
  `);
  const reservedStatement = db.prepare(`
    SELECT COALESCE(SUM(party_size), 0) AS reserved
    FROM registrations
    WHERE event_id = ? AND status = 'confirmed'
  `);
  const insertRegistrationStatement = db.prepare(`
    INSERT INTO registrations (
      id, event_id, contact_name, email, email_normalized, party_size,
      consent_version, confirmation_code, idempotency_key,
      request_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateEventStatusStatement = db.prepare(`
    UPDATE events
    SET status = ?, updated_at = ?
    WHERE id = ?
  `);
  const eventSummaryStatement = db.prepare(`
    SELECT
      e.id AS event_id,
      e.slug AS event_slug,
      e.name AS event_name,
      e.status AS stored_event_status,
      e.starts_at AS event_starts_at,
      e.ends_at AS event_ends_at,
      e.capacity,
      COUNT(r.id) AS total_registrations,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN 1 ELSE 0 END), 0)
        AS confirmed_registrations,
      COALESCE(SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END), 0)
        AS cancelled_registrations,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN r.party_size ELSE 0 END), 0)
        AS confirmed_spots,
      COALESCE(SUM(CASE WHEN r.status = 'cancelled' THEN r.party_size ELSE 0 END), 0)
        AS cancelled_spots
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    WHERE e.slug = ?
    GROUP BY e.id
  `);
  const listRegistrationsForEventStatement = db.prepare(`
    SELECT
      r.id,
      r.event_id,
      e.slug AS event_slug,
      r.contact_name,
      r.email,
      r.party_size,
      r.consent_version,
      r.confirmation_code,
      r.status,
      r.created_at,
      r.updated_at
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    WHERE e.slug = ?
    ORDER BY r.created_at ASC, r.id ASC
  `);
  const updateRegistrationStatusStatement = db.prepare(`
    UPDATE registrations
    SET status = 'cancelled', updated_at = ?
    WHERE id = ? AND status = 'confirmed'
  `);
  const insertAuditStatement = db.prepare(`
    INSERT INTO organizer_actions (
      action, actor, event_id, registration_id, previous_status,
      next_status, reason, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findAuditStatement = db.prepare('SELECT * FROM organizer_actions WHERE id = ?');

  const statuses = new Set(['draft', 'open', 'closed', 'completed', 'cancelled']);
  const allowedEventTransitions = new Map([
    ['draft', new Set(['open'])],
    ['open', new Set(['closed', 'completed', 'cancelled'])],
    ['closed', new Set(['completed', 'cancelled'])],
    ['completed', new Set()],
    ['cancelled', new Set()],
  ]);
  const timestamp = (now) => {
    const value = now instanceof Date ? now : new Date(now ?? Date.now());
    if (Number.isNaN(value.getTime())) throw new TypeError('now must be a valid date.');
    return value.toISOString();
  };
  const requiredAuditText = (value, field) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`${field} must be a non-empty string.`);
    }
    return value.trim();
  };
  const optionalAuditText = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new TypeError('reason must be a string.');
    return value.trim() || null;
  };
  const serializeDetails = (details) => {
    if (details === undefined || details === null) return null;
    if (typeof details !== 'object' || Array.isArray(details)) {
      throw new TypeError('details must be an object.');
    }
    return JSON.stringify(details);
  };
  const insertAudit = ({
    action,
    actor,
    eventId = null,
    registrationId = null,
    previousStatus = null,
    nextStatus = null,
    reason = null,
    details = null,
    now,
  }) => {
    const result = insertAuditStatement.run(
      requiredAuditText(action, 'action'),
      requiredAuditText(actor, 'actor'),
      eventId,
      registrationId,
      previousStatus,
      nextStatus,
      optionalAuditText(reason),
      serializeDetails(details),
      timestamp(now)
    );
    return findAuditStatement.get(result.lastInsertRowid);
  };

  return {
    events: {
      list() {
        return listEventsStatement.all();
      },
      findBySlug(slug) {
        return findEventStatement.get(slug) || null;
      },
      setStatus(slug, status, actor, reason, now) {
        if (!statuses.has(status)) {
          throw new TypeError(`Unsupported event status "${status}".`);
        }

        db.exec('BEGIN IMMEDIATE;');
        try {
          const event = findRawEventStatement.get(slug);
          if (!event) {
            db.exec('COMMIT;');
            return null;
          }
          const changedAt = timestamp(now);
          const changedAtMs = Date.parse(changedAt);
          const effectiveEndMs = Date.parse(event.ends_at || event.starts_at);
          const effectivelyCompleted =
            event.status !== 'draft' &&
            event.status !== 'cancelled' &&
            Number.isFinite(effectiveEndMs) &&
            effectiveEndMs <= changedAtMs;
          if (event.status === status) {
            if (effectivelyCompleted && status !== 'completed') {
              throw new Error(
                `Cannot keep event "${slug}" as "${status}" after it has ended; mark it completed.`
              );
            }
            db.exec('COMMIT;');
            return { event, changed: false };
          }

          if (!allowedEventTransitions.get(event.status)?.has(status)) {
            throw new Error(
              `Cannot transition event "${slug}" from "${event.status}" to "${status}".`
            );
          }

          if (effectivelyCompleted && status !== 'completed') {
            throw new Error(
              `Cannot transition event "${slug}" after it has ended; mark it completed.`
            );
          }
          if (event.status === 'draft' && status === 'open') {
            const startsAtMs = Date.parse(event.starts_at);
            const endsAtMs = event.ends_at ? Date.parse(event.ends_at) : Number.NaN;
            if (
              !event.ends_at ||
              !Number.isFinite(startsAtMs) ||
              !Number.isFinite(endsAtMs) ||
              startsAtMs <= changedAtMs ||
              endsAtMs <= changedAtMs
            ) {
              throw new Error(
                `Cannot open event "${slug}" unless its start and end times are in the future.`
              );
            }
          }
          if (status === 'completed') {
            if (!Number.isFinite(effectiveEndMs) || effectiveEndMs > changedAtMs) {
              throw new Error(
                `Cannot complete event "${slug}" before its end time.`
              );
            }
          }

          updateEventStatusStatement.run(status, changedAt, event.id);
          insertAudit({
            action: 'event.status_changed',
            actor,
            eventId: event.id,
            previousStatus: event.status,
            nextStatus: status,
            reason,
            now: changedAt,
          });
          const updatedEvent = findRawEventStatement.get(slug);
          db.exec('COMMIT;');
          return { event: updatedEvent, changed: true };
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      },
    },
    registrations: {
      findExactReplay(slug, registration) {
        const event = findRawEventStatement.get(slug);
        if (!event || event.status === 'draft') return null;
        const existing = findIdempotentStatement.get(event.id, registration.idempotencyKey);
        if (!existing || existing.request_fingerprint !== registration.requestFingerprint) {
          return null;
        }
        return event.status === 'cancelled' ? { ...existing, status: 'cancelled' } : existing;
      },
      createForEvent(slug, registration, now) {
        db.exec('BEGIN IMMEDIATE;');
        try {
          const event = findRawEventStatement.get(slug);
          if (!event || event.status === 'draft') {
            throw new RegistrationError('event_not_found', 'Event not found.');
          }

          const idempotent = findIdempotentStatement.get(event.id, registration.idempotencyKey);
          if (idempotent) {
            if (idempotent.request_fingerprint !== registration.requestFingerprint) {
              throw new RegistrationError(
                'idempotency_conflict',
                'This registration request conflicts with an earlier attempt. Refresh the page and try again.'
              );
            }
            if (idempotent.status === 'cancelled' || event.status === 'cancelled') {
              throw new RegistrationError(
                'registration_cancelled',
                'This registration was cancelled. Contact ABC if you need help.'
              );
            }
            db.exec('COMMIT;');
            return { registration: idempotent, duplicate: true };
          }

          const beforeRegistrationWindow =
            event.registration_opens_at && Date.parse(event.registration_opens_at) > now.getTime();
          const afterRegistrationWindow =
            event.registration_closes_at && Date.parse(event.registration_closes_at) <= now.getTime();
          if (
            event.status !== 'open' ||
            Date.parse(event.starts_at) <= now.getTime() ||
            beforeRegistrationWindow ||
            afterRegistrationWindow
          ) {
            throw new RegistrationError(
              'registration_closed',
              'Registration is not open for this event.'
            );
          }

          const { reserved } = reservedStatement.get(event.id);
          if (event.capacity !== null && reserved + registration.partySize > event.capacity) {
            throw new RegistrationError(
              'event_full',
              'There are not enough spots remaining for this registration.'
            );
          }

          insertRegistrationStatement.run(
            registration.id,
            event.id,
            registration.contactName,
            registration.email,
            registration.emailNormalized,
            registration.partySize,
            registration.consentVersion,
            registration.confirmationCode,
            registration.idempotencyKey,
            registration.requestFingerprint
          );
          const inserted = findIdempotentStatement.get(event.id, registration.idempotencyKey);
          db.exec('COMMIT;');
          return { registration: inserted, duplicate: false };
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      },
      findByConfirmationCode(code) {
        return findConfirmationStatement.get(code) || null;
      },
      summaryForEvent(slug, now = new Date()) {
        const summary = eventSummaryStatement.get(slug);
        if (!summary) return null;
        const {
          event_starts_at: eventStartsAt,
          event_ends_at: eventEndsAt,
          ...summaryFields
        } = summary;
        const nowMs = Date.parse(timestamp(now));
        const endsAtMs = Date.parse(eventEndsAt || eventStartsAt);
        const eventStatus =
          Number.isFinite(endsAtMs) &&
          endsAtMs <= nowMs &&
          summary.stored_event_status !== 'cancelled' &&
          summary.stored_event_status !== 'draft'
            ? 'completed'
            : summary.stored_event_status;
        return {
          ...summaryFields,
          event_status: eventStatus,
          remaining:
            summary.capacity === null
              ? null
              : Math.max(0, summary.capacity - summary.confirmed_spots),
        };
      },
      listForEvent(slug) {
        return listRegistrationsForEventStatement.all(slug);
      },
      cancelByConfirmationCode(code, actor, reason, now) {
        db.exec('BEGIN IMMEDIATE;');
        try {
          const registration = findConfirmationStatement.get(code);
          if (!registration) {
            db.exec('COMMIT;');
            return null;
          }
          if (registration.status === 'cancelled') {
            db.exec('COMMIT;');
            return { registration, changed: false };
          }

          const cancelledAt = timestamp(now);
          updateRegistrationStatusStatement.run(cancelledAt, registration.id);
          const event = findRawEventStatement.get(registration.event_slug);
          insertAudit({
            action: 'registration.cancelled',
            actor,
            eventId: event.id,
            registrationId: registration.id,
            previousStatus: registration.status,
            nextStatus: 'cancelled',
            reason,
            now: cancelledAt,
          });
          const updatedRegistration = findConfirmationStatement.get(code);
          db.exec('COMMIT;');
          return { registration: updatedRegistration, changed: true };
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      },
    },
    audit: {
      record({
        action,
        actor,
        eventId = null,
        registrationId = null,
        reason = null,
        details = null,
        now,
      }) {
        db.exec('BEGIN IMMEDIATE;');
        try {
          const recorded = insertAudit({
            action,
            actor,
            eventId,
            registrationId,
            reason,
            details,
            now,
          });
          db.exec('COMMIT;');
          return recorded;
        } catch (error) {
          db.exec('ROLLBACK;');
          throw error;
        }
      },
    },
  };
}

class RegistrationError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.status = code === 'event_not_found' ? 404 : status;
  }
}

module.exports = {
  ABC_DATABASE_APPLICATION_ID,
  RegistrationError,
  assertAbcDatabase,
  assertEventEndTimesReady,
  compareEventStatuses,
  configureDatabaseFile,
  createRepositories,
  migrateDatabase,
  openDatabase,
  planEventSync,
  pruneExpiredRegistrations,
  syncEventsFromManifest,
};
