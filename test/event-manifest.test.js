'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EventManifestValidationError,
  loadEventManifest,
  parseEventManifest,
  validateEventManifest,
} = require('../src/event-manifest');

const now = new Date('2026-09-04T12:00:00Z');

function validEvent(overrides = {}) {
  return {
    id: 'evt_fall_walk_2026',
    slug: 'fall-community-walk',
    name: 'Fall Community Walk',
    summary: 'A community walk supporting access to autism services.',
    startsAt: '2026-10-18T08:00:00-07:00',
    endsAt: '2026-10-18T11:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'North Mountain Park',
    costLabel: 'Free',
    partner: 'Community Partner',
    fundsRaisedCents: null,
    status: 'open',
    capacity: 100,
    registrationOpensAt: '2026-09-18T08:00:00-07:00',
    registrationClosesAt: '2026-10-18T08:00:00-07:00',
    ...overrides,
  };
}

function assertManifestError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof EventManifestValidationError);
    assert.match(error.message, pattern);
    assert.ok(Array.isArray(error.issues));
    return true;
  });
}

test('validates arrays and JSON strings and returns normalized event objects', () => {
  const input = validEvent({
    name: '  Fall Community Walk  ',
    timezone: 'US/Arizona',
  });

  const fromArray = validateEventManifest([input], { now });
  const fromJson = parseEventManifest(JSON.stringify([input]), { now });

  assert.deepEqual(fromJson, fromArray);
  assert.equal(fromArray[0].name, 'Fall Community Walk');
  assert.equal(fromArray[0].timezone, 'America/Phoenix');
  assert.notStrictEqual(fromArray[0], input);
});

test('loads and validates a manifest from disk', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-event-manifest-'));
  const filename = path.join(directory, 'events.json');
  fs.writeFileSync(filename, JSON.stringify([validEvent()]));
  t.after(() => fs.rmSync(directory, { recursive: true }));

  const events = loadEventManifest(filename, { now });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'evt_fall_walk_2026');
});

test('reports invalid JSON and unreadable files as manifest validation errors', () => {
  assertManifestError(() => validateEventManifest('[}'), /manifest is not valid JSON/);
  assertManifestError(
    () => loadEventManifest('/definitely/missing/events.json'),
    /could not read manifest/
  );
});

test('requires an array of event objects', () => {
  assertManifestError(() => validateEventManifest({ events: [] }), /JSON string or an array/);
  assertManifestError(() => validateEventManifest('{}'), /top-level value must be an array/);
  assertManifestError(() => validateEventManifest([null]), /events\[0\]: must be an object/);
});

test('enforces unique stable IDs and kebab-case slugs', () => {
  assertManifestError(
    () =>
      validateEventManifest(
        [validEvent(), validEvent({ name: 'Second event' })],
        { now }
      ),
    /events\[1\]\.id: duplicates events\[0\]\.id/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ id: 'Event 123', slug: 'Fall_Walk' })], { now }),
    /events\[0\]\.id: must use lowercase/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ slug: 'Fall_Walk' })], { now }),
    /events\[0\]\.slug: must be a lowercase kebab-case slug/
  );
  assertManifestError(
    () =>
      validateEventManifest(
        [validEvent(), validEvent({ id: 'evt_second_2026', name: 'Second event' })],
        { now }
      ),
    /events\[1\]\.slug: duplicates events\[0\]\.slug/
  );
});

test('requires bounded, nonempty strings and rejects unknown fields', () => {
  assertManifestError(
    () => validateEventManifest([validEvent({ name: '   ' })], { now }),
    /events\[0\]\.name: must not be empty/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ summary: 'x'.repeat(601) })], { now }),
    /events\[0\]\.summary: must be 600 characters or fewer/
  );
  assertManifestError(
    () => validateEventManifest([{ ...validEvent(), startsAT: validEvent().startsAt }], { now }),
    /events\[0\]\.startsAT: is not a supported event field/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ partner: '   ' })], { now }),
    /events\[0\]\.partner: must not be empty/
  );
});

test('allows events without a partner', () => {
  const [event] = validateEventManifest([validEvent({ partner: null })], { now });

  assert.equal(event.partner, null);
});

test('allows only supported statuses', () => {
  assertManifestError(
    () => validateEventManifest([validEvent({ status: 'published' })], { now }),
    /must be one of: draft, open, closed, cancelled, completed/
  );
});

test('requires timezone-aware, real ISO timestamps and a recognized IANA timezone', () => {
  assertManifestError(
    () => validateEventManifest([validEvent({ startsAt: '2026-10-18T08:00:00' })], { now }),
    /startsAt: must use ISO 8601 date-time format and include a timezone/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ startsAt: '2026-02-30T08:00:00Z' })], { now }),
    /startsAt: contains an invalid calendar date/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ startsAt: '2026-10-18T08:00:00\+15:00' })], { now }),
    /startsAt: contains a UTC offset outside the ISO 8601 range/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ timezone: 'PST' })], { now }),
    /timezone: must be an IANA timezone/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ timezone: 'America/Not_A_Zone' })], { now }),
    /timezone: "America\/Not_A_Zone" is not a recognized IANA timezone/
  );
});

test('requires timestamp offsets to match the declared timezone', () => {
  assertManifestError(
    () =>
      validateEventManifest(
        [validEvent({ startsAt: '2026-10-18T08:00:00-06:00' })],
        { now }
      ),
    /startsAt: uses UTC offset -06:00, but America\/Phoenix uses -07:00 at that instant/
  );
});

test('checks DST-aware offsets independently at each timestamp', () => {
  const newYorkEvent = validEvent({
    timezone: 'America/New_York',
    startsAt: '2026-11-15T08:00:00-05:00',
    endsAt: '2026-11-15T11:00:00-05:00',
    registrationOpensAt: '2026-07-01T08:00:00-04:00',
    registrationClosesAt: '2026-11-14T20:00:00-05:00',
  });

  assert.doesNotThrow(() => validateEventManifest([newYorkEvent], { now }));
  assertManifestError(
    () =>
      validateEventManifest(
        [{ ...newYorkEvent, registrationOpensAt: '2026-07-01T08:00:00-05:00' }],
        { now }
      ),
    /registrationOpensAt: uses UTC offset -05:00, but America\/New_York uses -04:00 at that instant/
  );
});

test('requires endsAt after startsAt for current and future events', () => {
  assertManifestError(
    () => validateEventManifest([validEvent({ endsAt: '2026-10-18T08:00:00-07:00' })], { now }),
    /endsAt: must be later than startsAt/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ endsAt: null })], { now }),
    /endsAt: may be null only for a completed event whose start time is at or before the validation time/
  );
});

test('permits a missing end only for a completed historical event', () => {
  const [event] = validateEventManifest(
    [
      validEvent({
        status: 'completed',
        startsAt: '2025-11-15T07:30:00-07:00',
        endsAt: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
      }),
    ],
    { now }
  );

  assert.equal(event.endsAt, null);
  assertManifestError(
    () =>
      validateEventManifest(
        [validEvent({ status: 'completed', endsAt: null })],
        { now }
      ),
    /endsAt: may be null only for a completed event whose start time is at or before the validation time/
  );
});

test('rejects completed status until the effective event end has passed', () => {
  assertManifestError(
    () =>
      validateEventManifest(
        [
          validEvent({
            status: 'completed',
            startsAt: '2026-09-04T10:00:00Z',
            endsAt: '2026-09-04T13:00:00Z',
            timezone: 'UTC',
            registrationOpensAt: null,
            registrationClosesAt: null,
          }),
        ],
        { now }
      ),
    /status: cannot be completed until endsAt/
  );

  assert.doesNotThrow(() =>
    validateEventManifest(
      [
        validEvent({
          status: 'completed',
          startsAt: '2026-09-04T10:00:00Z',
          endsAt: '2026-09-04T12:00:00Z',
          timezone: 'UTC',
          registrationOpensAt: null,
          registrationClosesAt: null,
        }),
      ],
      { now }
    )
  );
});

test('enforces coherent registration windows', () => {
  assertManifestError(
    () =>
      validateEventManifest(
        [
          validEvent({
            registrationOpensAt: '2026-10-17T08:00:00-07:00',
            registrationClosesAt: '2026-10-16T08:00:00-07:00',
          }),
        ],
        { now }
      ),
    /registrationOpensAt: must be earlier than registrationClosesAt/
  );
  assertManifestError(
    () =>
      validateEventManifest(
        [validEvent({ registrationClosesAt: '2026-10-18T08:00:01-07:00' })],
        { now }
      ),
    /registrationClosesAt: must be earlier than or equal to startsAt/
  );
  assert.doesNotThrow(() =>
    validateEventManifest(
      [validEvent({ registrationOpensAt: null, registrationClosesAt: null })],
      { now }
    )
  );
});

test('validates nullable capacity and fundraising amounts', () => {
  assert.doesNotThrow(() =>
    validateEventManifest([validEvent({ capacity: null, fundsRaisedCents: 0 })], { now })
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ capacity: 0 })], { now }),
    /capacity: must be a positive integer or null/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ capacity: 1.5 })], { now }),
    /capacity: must be a safe integer or null/
  );
  assertManifestError(
    () => validateEventManifest([validEvent({ fundsRaisedCents: -1 })], { now }),
    /fundsRaisedCents: must be a nonnegative integer or null/
  );
});

test('rejects an invalid validation clock', () => {
  assert.throws(
    () => validateEventManifest([validEvent()], { now: 'not-a-date' }),
    /options\.now must be a valid Date or timestamp/
  );
});
