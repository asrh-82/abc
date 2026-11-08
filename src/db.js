const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const EVENT_COLUMNS = `
  e.id,
  e.slug,
  e.name,
  e.summary,
  e.starts_at,
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

function openDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
    }
  }
  return db;
}

function migrateDatabase(db, migrationsPath) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((row) => row.name)
  );
  const migrationFiles = fs
    .readdirSync(migrationsPath)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of migrationFiles) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(migrationsPath, name), 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}

function seedEventsIfEmpty(db, eventSeedPath) {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM events').get();
  if (total > 0) return false;

  const events = JSON.parse(fs.readFileSync(eventSeedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO events (
      id, slug, name, summary, starts_at, timezone, location_name,
      cost_label, partner, funds_raised_cents, status, capacity,
      registration_opens_at, registration_closes_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const event of events) {
      insert.run(
        event.id,
        event.slug,
        event.name,
        event.summary,
        event.startsAt,
        event.timezone,
        event.locationName,
        event.costLabel,
        event.partner,
        event.fundsRaisedCents,
        event.status,
        event.capacity,
        event.registrationOpensAt,
        event.registrationClosesAt
      );
    }
    db.exec('COMMIT;');
    return true;
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
      WHERE datetime(starts_at) < datetime(?)
    )
  `).run(threshold);
  return Number(result.changes);
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

  return {
    events: {
      list() {
        return listEventsStatement.all();
      },
      findBySlug(slug) {
        return findEventStatement.get(slug) || null;
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
  RegistrationError,
  createRepositories,
  migrateDatabase,
  openDatabase,
  pruneExpiredRegistrations,
  seedEventsIfEmpty,
};
