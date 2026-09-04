PRAGMA application_id = 1094861617;

ALTER TABLE events ADD COLUMN ends_at TEXT;

CREATE INDEX idx_events_ends_at
ON events(ends_at);

CREATE TABLE organizer_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 100),
  actor TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 200),
  event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  registration_id TEXT REFERENCES registrations(id) ON DELETE SET NULL,
  previous_status TEXT,
  next_status TEXT,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_organizer_actions_event_created_at
ON organizer_actions(event_id, created_at);

CREATE INDEX idx_organizer_actions_registration_created_at
ON organizer_actions(registration_id, created_at)
WHERE registration_id IS NOT NULL;

CREATE INDEX idx_organizer_actions_action_created_at
ON organizer_actions(action, created_at);
