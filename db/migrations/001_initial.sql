CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  location_name TEXT NOT NULL,
  cost_label TEXT NOT NULL,
  partner TEXT,
  funds_raised_cents INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'closed', 'completed', 'cancelled')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  registration_opens_at TEXT,
  registration_closes_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 10),
  consent_version TEXT NOT NULL,
  confirmation_code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_registrations_event_email
ON registrations(event_id, email_normalized)
WHERE status = 'confirmed';

CREATE UNIQUE INDEX idx_registrations_event_idempotency
ON registrations(event_id, idempotency_key);

CREATE INDEX idx_registrations_event_status
ON registrations(event_id, status);

CREATE INDEX idx_events_status_starts_at
ON events(status, starts_at);
