const assert = require('node:assert/strict');
const test = require('node:test');

const { formatEventDate, formatEventSchedule } = require('../src/http');
const { confirmationPage, eventDetailPage, registrationPage } = require('../src/views/pages');

function eventFixture(overrides = {}) {
  return {
    slug: 'fall-community-day',
    name: 'Fall Community Day',
    summary: 'A community event in Phoenix.',
    startsAt: '2026-10-10T09:00:00-07:00',
    endsAt: '2026-10-10T12:30:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Phoenix, Arizona',
    costLabel: 'Free',
    partner: null,
    fundsRaisedCents: null,
    registrationState: 'open',
    registrationOpen: true,
    remaining: 20,
    ...overrides,
  };
}

test('same-day events show one local date and a local start-to-end time range', () => {
  const event = eventFixture();

  assert.deepEqual(formatEventSchedule(event), {
    date: 'Saturday, October 10, 2026',
    time: '9:00 AM–12:30 PM MST',
  });

  const detail = eventDetailPage(event);
  const registration = registrationPage(event, { csrfToken: 'test-token' });
  assert.match(detail, /<dt>Date<\/dt><dd>Saturday, October 10, 2026<\/dd>/);
  assert.match(detail, /<dt>Time<\/dt><dd>9:00 AM–12:30 PM MST<\/dd>/);
  assert.match(registration, /<strong>Saturday, October 10, 2026<\/strong><br>9:00 AM–12:30 PM MST/);
});

test('multi-day events label both local dates and their corresponding times', () => {
  const event = eventFixture({
    startsAt: '2026-10-10T23:00:00-07:00',
    endsAt: '2026-10-11T01:30:00-07:00',
  });

  assert.deepEqual(formatEventSchedule(event), {
    date: 'Starts Saturday, October 10, 2026; ends Sunday, October 11, 2026',
    time: 'Starts 11:00 PM MST; ends 1:30 AM MST',
  });
});

test('confirmation pages retain same-day start and end times', () => {
  const confirmation = confirmationPage({
    starts_at: '2026-10-10T09:00:00-07:00',
    ends_at: '2026-10-10T12:30:00-07:00',
    timezone: 'America/Phoenix',
    status: 'confirmed',
    event_status: 'open',
    event_name: 'Fall Community Day',
    event_slug: 'fall-community-day',
    location_name: 'Phoenix, Arizona',
    party_size: 2,
    confirmation_code: 'ABC-TEST',
  });

  assert.match(
    confirmation,
    /<dt>When<\/dt><dd>Saturday, October 10, 2026 · 9:00 AM–12:30 PM MST<\/dd>/
  );
});

test('confirmation pages retain both dates for multi-day events', () => {
  const confirmation = confirmationPage({
    starts_at: '2026-10-10T23:00:00-07:00',
    ends_at: '2026-10-11T01:30:00-07:00',
    timezone: 'America/Phoenix',
    status: 'confirmed',
    event_status: 'open',
    event_name: 'Fall Community Day',
    event_slug: 'fall-community-day',
    location_name: 'Phoenix, Arizona',
    party_size: 2,
    confirmation_code: 'ABC-TEST',
  });

  assert.match(
    confirmation,
    /Starts Saturday, October 10, 2026; ends Sunday, October 11, 2026 · Starts 11:00 PM MST; ends 1:30 AM MST/
  );
});

test('historical events without an end time keep the existing start display', () => {
  const event = eventFixture({
    startsAt: '2025-03-15T08:00:00-07:00',
    endsAt: null,
    registrationState: 'completed',
    registrationOpen: false,
    remaining: null,
  });
  const start = formatEventDate(event);

  assert.deepEqual(formatEventSchedule(event), {
    date: start.fullDate,
    time: start.time,
  });
});
