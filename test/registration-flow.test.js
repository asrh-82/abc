const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const { createApp } = require('../src/app');
const {
  createRepositories,
  migrateDatabase,
  openDatabase,
  pruneExpiredRegistrations,
  syncEventsFromManifest,
} = require('../src/db');
const { loadEventManifest } = require('../src/event-manifest');
const { SITEVERIFY_URL, createTurnstileVerifier } = require('../src/turnstile');

const projectRoot = path.resolve(__dirname, '..');
const fixedNow = new Date('2026-09-03T12:00:00-07:00');

async function startTestApp(t, configureDatabase = () => {}, appOptions = {}) {
  const db = openDatabase(':memory:');
  migrateDatabase(db, path.join(projectRoot, 'db', 'migrations'));
  syncEventsFromManifest(
    db,
    loadEventManifest(path.join(projectRoot, 'data', 'events.json'), { now: fixedNow })
  );
  configureDatabase(db);

  const app = createApp({
    repositories: createRepositories(db),
    projectRoot,
    now: () => fixedNow,
    registrationProtectionReady: true,
    verifyHuman: async () => ({ ok: true }),
    ...appOptions,
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  return { baseUrl, db };
}

function openTennisRegistration(db, { capacity = 64 } = {}) {
  db.prepare(`
    UPDATE events
    SET starts_at = ?, status = 'open', capacity = ?
    WHERE slug = 'community-tennis-tournament'
  `).run('2026-10-18T07:30:00-07:00', capacity);
}

function registrationPayload(overrides = {}) {
  return {
    contactName: 'Jordan Lee',
    email: 'jordan@example.com',
    partySize: 1,
    consent: true,
    website: '',
    idempotencyKey: crypto.randomUUID(),
    turnstileToken: 'test-turnstile-token',
    ...overrides,
  };
}

test('stale open events never appear as upcoming', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => {
    db.prepare("UPDATE events SET status = 'open' WHERE slug = 'community-tennis-tournament'").run();
  });

  const response = await fetch(`${baseUrl}/api/v1/events`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.meta.count, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('homepage is impact-first when no event is confirmed', async (t) => {
  const { baseUrl } = await startTestApp(t);

  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /No upcoming event announced/);
  assert.match(html, /There is no signup open right now/);
  assert.match(html, />See our impact</);
  assert.doesNotMatch(html, />Find an event</);
});

test('events page states that no upcoming event has been announced', async (t) => {
  const { baseUrl } = await startTestApp(t);

  const response = await fetch(`${baseUrl}/events`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(html, /No upcoming event has been announced/);
  assert.match(html, /id="past-events"/);
  assert.doesNotMatch(html, /View recap/);
});

test('a past closed event is normalized as completed', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => {
    db.prepare("UPDATE events SET status = 'closed' WHERE slug = 'community-tennis-tournament'").run();
  });

  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'completed');
  assert.equal(body.data.registrationState, 'completed');
});

test('event API exposes an open future event without private registration data', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.registrationOpen, true);
  assert.equal(body.data.remaining, 64);
  assert.equal('registrations' in body.data, false);
});

test('event API rejects an unknown scope', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const response = await fetch(`${baseUrl}/api/v1/events?scope=everything`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_scope');
});

test('an exact idempotent retry returns the same confirmation without consuming capacity twice', async (t) => {
  let verificationCalls = 0;
  const { baseUrl } = await startTestApp(
    t,
    (db) => openTennisRegistration(db),
    {
      verifyHuman: async () => {
        verificationCalls += 1;
        return { ok: verificationCalls === 1 };
      },
    }
  );
  const payload = registrationPayload({ partySize: 2 });

  const first = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const firstBody = await first.json();

  const retry = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const retryBody = await retry.json();

  const eventResponse = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const eventBody = await eventResponse.json();

  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retryBody.data.duplicate, true);
  assert.equal(retryBody.data.confirmationCode, firstBody.data.confirmationCode);
  assert.equal(eventBody.data.remaining, 62);
  assert.equal(verificationCalls, 1);
});

test('same email with a new request creates an independent registration without exposing the first', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;

  const first = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload()),
  });
  const firstBody = await first.json();
  const duplicate = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload()),
  });
  const duplicateBody = await duplicate.json();

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 201);
  assert.equal(JSON.stringify(duplicateBody).includes(firstBody.data.confirmationCode), false);
  assert.notEqual(duplicateBody.data.confirmationCode, firstBody.data.confirmationCode);
});

test('reusing an idempotency key with changed details is rejected', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;
  const payload = registrationPayload();

  await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const conflict = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, partySize: 2 }),
  });
  const body = await conflict.json();

  assert.equal(conflict.status, 409);
  assert.equal(body.error.code, 'idempotency_conflict');
});

test('capacity is enforced inside the registration transaction', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db, { capacity: 2 }));

  const first = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload({ partySize: 2 })),
  });
  const second = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload({ email: 'second@example.com' })),
  });
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(secondBody.error.code, 'event_full');
});

test('back-to-back requests cannot overbook the last spot', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db, { capacity: 1 }));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;
  const request = (email) => fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload({ email })),
  });

  const responses = await Promise.all([
    request('first@example.com'),
    request('second@example.com'),
  ]);
  const statuses = responses.map((response) => response.status).sort();

  assert.deepEqual(statuses, [201, 409]);
});

test('registration windows are enforced independently of the event date', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => {
    openTennisRegistration(db);
    db.prepare(`
      UPDATE events SET registration_opens_at = ?
      WHERE slug = 'community-tennis-tournament'
    `).run('2026-09-10T00:00:00-07:00');
  });

  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.registrationOpen, false);
});

test('closed events reject new registrations', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload()),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'registration_closed');
});

test('draft event slugs are indistinguishable from unknown events', async (t) => {
  const { baseUrl, db } = await startTestApp(t, (database) => {
    database.prepare("UPDATE events SET status = 'draft' WHERE slug = 'community-tennis-tournament'").run();
  });
  assert.ok(db);
  const payload = registrationPayload();
  const draftResponse = await fetch(
    `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const unknownResponse = await fetch(`${baseUrl}/api/v1/events/not-a-real-event/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }),
  });
  const [draftBody, unknownBody] = await Promise.all([
    draftResponse.json(),
    unknownResponse.json(),
  ]);

  assert.equal(draftResponse.status, 404);
  assert.equal(unknownResponse.status, 404);
  assert.deepEqual(draftBody, unknownBody);
});

test('web registration requires a matching CSRF token and ends on confirmation', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const formResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`);
  const formHtml = await formResponse.text();
  const cookie = formResponse.headers.get('set-cookie').split(';')[0];
  const csrfToken = formHtml.match(/name="csrfToken" value="([^"]+)"/)[1];
  const idempotencyKey = formHtml.match(/name="idempotencyKey" value="([^"]+)"/)[1];
  const form = new URLSearchParams({
    csrfToken,
    idempotencyKey,
    contactName: 'Taylor Morgan',
    email: 'taylor@example.com',
    partySize: '1',
    consent: 'on',
    website: '',
  });

  const submitResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: form,
    redirect: 'manual',
  });

  assert.equal(formResponse.status, 200);
  assert.equal(submitResponse.status, 303);
  assert.match(submitResponse.headers.get('location'), /^\/registration\/confirmed\//);

  const confirmationResponse = await fetch(
    `${baseUrl}${submitResponse.headers.get('location')}`
  );
  const confirmationHtml = await confirmationResponse.text();
  assert.equal(confirmationResponse.status, 200);
  assert.match(confirmationHtml, /You’re registered/);
  assert.doesNotMatch(confirmationHtml, /taylor@example\.com/);
});

test('web registration rejects a missing CSRF cookie', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const formResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`);
  const formHtml = await formResponse.text();
  const csrfToken = formHtml.match(/name="csrfToken" value="([^"]+)"/)[1];
  const idempotencyKey = formHtml.match(/name="idempotencyKey" value="([^"]+)"/)[1];
  const form = new URLSearchParams({
    csrfToken,
    idempotencyKey,
    contactName: 'Taylor Morgan',
    email: 'taylor@example.com',
    partySize: '1',
    consent: 'on',
  });

  const submitResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
  });
  const html = await submitResponse.text();

  assert.equal(submitResponse.status, 422);
  assert.match(html, /Your form expired/);
});

test('web registration treats a malformed CSRF cookie as invalid', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const formResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`);
  const formHtml = await formResponse.text();
  const csrfToken = formHtml.match(/name="csrfToken" value="([^"]+)"/)[1];
  const idempotencyKey = formHtml.match(/name="idempotencyKey" value="([^"]+)"/)[1];
  const form = new URLSearchParams({
    csrfToken,
    idempotencyKey,
    contactName: 'Taylor Morgan',
    email: 'taylor@example.com',
    partySize: '1',
    consent: 'on',
  });

  const submitResponse = await fetch(`${baseUrl}/events/community-tennis-tournament/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: 'abc_csrf=%E0%A4%A',
    },
    body: form,
    redirect: 'manual',
  });
  const html = await submitResponse.text();

  assert.equal(submitResponse.status, 422);
  assert.match(html, /Your form expired/);
});

test('opening a second registration tab does not invalidate the first form', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const endpoint = `${baseUrl}/events/community-tennis-tournament/register`;
  const firstResponse = await fetch(endpoint);
  const firstHtml = await firstResponse.text();
  const cookie = firstResponse.headers.get('set-cookie').split(';')[0];
  const firstToken = firstHtml.match(/name="csrfToken" value="([^"]+)"/)[1];
  const firstIdempotencyKey = firstHtml.match(/name="idempotencyKey" value="([^"]+)"/)[1];
  const secondResponse = await fetch(endpoint, { headers: { cookie } });
  const secondHtml = await secondResponse.text();
  const secondToken = secondHtml.match(/name="csrfToken" value="([^"]+)"/)[1];

  const submitResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: new URLSearchParams({
      csrfToken: firstToken,
      idempotencyKey: firstIdempotencyKey,
      contactName: 'Taylor Morgan',
      email: 'taylor@example.com',
      partySize: '1',
      consent: 'on',
    }),
    redirect: 'manual',
  });

  assert.equal(secondToken, firstToken);
  assert.equal(submitResponse.status, 303);
});

test('human verification failure does not consume event capacity', async (t) => {
  let verificationRequest;
  const { baseUrl } = await startTestApp(
    t,
    (db) => openTennisRegistration(db),
    {
      verifyHuman: async (request) => {
        verificationRequest = request;
        return { ok: false };
      },
    }
  );
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload()),
  });
  const body = await response.json();
  const eventResponse = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const eventBody = await eventResponse.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'human_verification_failed');
  assert.equal(eventBody.data.remaining, 64);
  assert.equal(verificationRequest.token, 'test-turnstile-token');
  assert.match(verificationRequest.idempotencyKey, /^[a-f0-9-]{36}$/);
});

test('registration fails closed when production protection is not configured', async (t) => {
  const { baseUrl } = await startTestApp(
    t,
    (db) => openTennisRegistration(db),
    { registrationProtectionReady: false }
  );
  const eventResponse = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament`);
  const eventBody = await eventResponse.json();
  const formResponse = await fetch(
    `${baseUrl}/events/community-tennis-tournament/register`,
    { redirect: 'manual' }
  );
  const registrationResponse = await fetch(
    `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationPayload()),
    }
  );
  const registrationBody = await registrationResponse.json();

  assert.equal(eventBody.data.registrationOpen, false);
  assert.equal(eventBody.data.registrationState, 'closed');
  assert.equal(formResponse.status, 303);
  assert.equal(registrationResponse.status, 503);
  assert.equal(registrationBody.error.code, 'verification_unavailable');
});

test('runtime configuration never bypasses missing Turnstile settings', () => {
  const environment = { ...process.env };
  delete environment.NODE_ENV;
  delete environment.TURNSTILE_SITE_KEY;
  delete environment.TURNSTILE_SECRET_KEY;
  delete environment.TURNSTILE_EXPECTED_HOSTNAME;
  const output = execFileSync(
    process.execPath,
    ['-e', "process.stdout.write(String(require('./src/config').registrationProtectionReady))"],
    { cwd: projectRoot, env: environment, encoding: 'utf8' }
  );

  assert.equal(output, 'false');
});

test('registration form renders the official Turnstile widget contract', async (t) => {
  const { baseUrl } = await startTestApp(
    t,
    (db) => openTennisRegistration(db),
    { turnstileSiteKey: 'site-key-from-config' }
  );
  const response = await fetch(`${baseUrl}/events/community-tennis-tournament/register`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  assert.match(html, /data-sitekey="site-key-from-config"/);
  assert.match(html, /data-action="event-registration"/);
});

test('invalid registration returns bounded field errors', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload({
      contactName: '',
      email: 'not-an-email',
      partySize: 25,
      consent: false,
    })),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.ok(body.error.fields.contactName);
  assert.ok(body.error.fields.email);
  assert.ok(body.error.fields.partySize);
  assert.ok(body.error.fields.consent);
});

test('party size parsing rejects decimals and mixed strings', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;

  for (const partySize of [1.9, '2people']) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationPayload({ partySize })),
    });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.ok(body.error.fields.partySize);
  }
});

test('registration requires a UUIDv4 idempotency key', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registrationPayload({ idempotencyKey: '--------------------' })),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'invalid_registration');
});

test('malformed JSON returns a structured client error', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"contactName":',
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_json');
});

test('unsupported JSON charset returns a structured 415 response', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=koi8-r' },
    body: JSON.stringify(registrationPayload()),
  });
  const body = await response.json();

  assert.equal(response.status, 415);
  assert.equal(body.error.code, 'unsupported_media_type');
});

test('oversized API payload returns 413 instead of an internal error', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const response = await fetch(`${baseUrl}/api/v1/events/community-tennis-tournament/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oversized: 'x'.repeat(17 * 1024) }),
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'payload_too_large');
});

test('unknown API routes return structured JSON', async (t) => {
  const { baseUrl } = await startTestApp(t);
  const response = await fetch(`${baseUrl}/api/v1/unknown`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type').includes('application/json'), true);
  assert.equal(body.error.code, 'not_found');
});

test('forwarded IP spoofing does not bypass the default registration limiter', async (t) => {
  const { baseUrl } = await startTestApp(t, (db) => openTennisRegistration(db));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;
  let response;

  for (let index = 0; index < 6; index += 1) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${index + 1}`,
      },
      body: JSON.stringify(registrationPayload({
        email: `person-${index}@example.com`,
      })),
    });
  }

  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error.code, 'rate_limited');
  assert.ok(response.headers.get('retry-after'));
});

test('registration retention deletes records after the configured post-event window', async (t) => {
  const { baseUrl, db } = await startTestApp(t, (database) => openTennisRegistration(database));
  const createResponse = await fetch(
    `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registrationPayload()),
    }
  );
  assert.equal(createResponse.status, 201);

  db.prepare(`
    UPDATE events SET starts_at = ?, status = 'completed'
    WHERE slug = 'community-tennis-tournament'
  `).run('2026-07-01T07:30:00-07:00');
  const deleted = pruneExpiredRegistrations(db, fixedNow, 30);
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM registrations').get();

  assert.equal(deleted, 1);
  assert.equal(total, 0);
});

test('a cancelled registration cannot replay as confirmed', async (t) => {
  const { baseUrl, db } = await startTestApp(t, (database) => openTennisRegistration(database));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;
  const payload = registrationPayload();
  const createdResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const createdBody = await createdResponse.json();
  db.prepare('UPDATE registrations SET status = ? WHERE id = ?')
    .run('cancelled', createdBody.data.registrationId);

  const replayResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const replayBody = await replayResponse.json();
  const confirmationResponse = await fetch(
    `${baseUrl}/registration/confirmed/${createdBody.data.confirmationCode}`
  );
  const confirmationHtml = await confirmationResponse.text();

  assert.equal(replayResponse.status, 409);
  assert.equal(replayBody.error.code, 'registration_cancelled');
  assert.match(confirmationHtml, /Registration cancelled/);
  assert.doesNotMatch(confirmationHtml, /You’re registered/);
});

test('cancelling an event also closes existing confirmation and replay paths', async (t) => {
  const { baseUrl, db } = await startTestApp(t, (database) => openTennisRegistration(database));
  const endpoint = `${baseUrl}/api/v1/events/community-tennis-tournament/registrations`;
  const payload = registrationPayload();
  const createdResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const createdBody = await createdResponse.json();
  db.prepare('UPDATE events SET status = ? WHERE slug = ?')
    .run('cancelled', 'community-tennis-tournament');

  const replayResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const replayBody = await replayResponse.json();
  const confirmationResponse = await fetch(
    `${baseUrl}/registration/confirmed/${createdBody.data.confirmationCode}`
  );
  const confirmationHtml = await confirmationResponse.text();

  assert.equal(replayResponse.status, 409);
  assert.equal(replayBody.error.code, 'registration_cancelled');
  assert.match(confirmationHtml, /Registration cancelled/);
  assert.doesNotMatch(confirmationHtml, /You’re registered/);
});

test('Turnstile verifier sends bounded server-side validation and enforces context', async () => {
  const requests = [];
  const verifier = createTurnstileVerifier({
    secretKey: 'server-secret',
    expectedHostname: 'autismbringingchange.xyz',
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({
          success: true,
          action: 'event-registration',
          hostname: 'autismbringingchange.xyz',
        }),
      };
    },
  });
  const result = await verifier({
    token: 'browser-token',
    remoteIp: '203.0.113.8',
    idempotencyKey: '3e990ee4-6d78-4428-8c3a-c98bb17efb75',
  });
  await verifier({
    token: 'refreshed-browser-token',
    remoteIp: '203.0.113.8',
    idempotencyKey: '3e990ee4-6d78-4428-8c3a-c98bb17efb75',
  });
  await verifier({
    token: 'browser-token',
    remoteIp: '203.0.113.8',
    idempotencyKey: '3e990ee4-6d78-4428-8c3a-c98bb17efb75',
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requests[0].url, SITEVERIFY_URL);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].body.secret, 'server-secret');
  assert.equal(requests[0].body.response, 'browser-token');
  assert.equal(requests[0].body.remoteip, '203.0.113.8');
  assert.match(requests[0].body.idempotency_key, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(requests[1].body.idempotency_key, requests[0].body.idempotency_key);
  assert.equal(requests[2].body.idempotency_key, requests[0].body.idempotency_key);
});

test('Turnstile verifier rejects the wrong action or hostname', async () => {
  const verifier = createTurnstileVerifier({
    secretKey: 'server-secret',
    expectedHostname: 'autismbringingchange.xyz',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        success: true,
        action: 'different-action',
        hostname: 'attacker.example',
      }),
    }),
  });

  assert.deepEqual(await verifier({ token: 'browser-token' }), { ok: false });
});

test('Turnstile verifier never bypasses a missing secret', async () => {
  const verifier = createTurnstileVerifier();
  assert.deepEqual(
    await verifier({ token: 'browser-token' }),
    { ok: false, unavailable: true }
  );
});
