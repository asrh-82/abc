const assert = require('node:assert/strict');
const test = require('node:test');

const { splitEvents, toPublicEvent } = require('../src/services');

function eventRow(overrides = {}) {
  return {
    id: 'evt_current',
    slug: 'current-event',
    name: 'Current event',
    summary: 'A test event.',
    starts_at: '2026-09-04T10:00:00-07:00',
    ends_at: '2026-09-04T13:00:00-07:00',
    timezone: 'America/Phoenix',
    location_name: 'Phoenix, Arizona',
    cost_label: 'Free',
    partner: null,
    funds_raised_cents: null,
    status: 'open',
    capacity: 20,
    registration_opens_at: null,
    registration_closes_at: null,
    reserved: 4,
    ...overrides,
  };
}

test('an event in progress is current but registration is closed after kickoff', () => {
  const now = new Date('2026-09-04T11:00:00-07:00');
  const event = toPublicEvent(eventRow(), now);
  const collections = splitEvents([eventRow()], now);

  assert.equal(event.status, 'open');
  assert.equal(event.registrationState, 'closed');
  assert.equal(event.registrationOpen, false);
  assert.deepEqual(collections.upcoming.map((item) => item.slug), ['current-event']);
  assert.equal(collections.past.length, 0);
});

test('an event becomes completed only after its end time', () => {
  const now = new Date('2026-09-04T13:00:00-07:00');
  const event = toPublicEvent(eventRow(), now);
  const collections = splitEvents([eventRow()], now);

  assert.equal(event.status, 'completed');
  assert.equal(event.registrationState, 'completed');
  assert.equal(collections.upcoming.length, 0);
  assert.deepEqual(collections.past.map((item) => item.slug), ['current-event']);
});

test('cancelled events are kept out of upcoming and past collections', () => {
  const now = new Date('2026-09-04T08:00:00-07:00');
  const collections = splitEvents([eventRow({ status: 'cancelled' })], now);

  assert.equal(collections.upcoming.length, 0);
  assert.equal(collections.past.length, 0);
  assert.deepEqual(collections.cancelled.map((item) => item.slug), ['current-event']);
});
