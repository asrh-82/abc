const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildStatic } = require('../scripts/build-static');
const vercelConfig = require('../vercel.json');

function readHtmlFiles(directory) {
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

test('static previews never expose registration for a future open event', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-static-build-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const futureEvent = {
    id: 'evt_preview_only',
    slug: 'preview-only-event',
    name: 'Preview Only Event',
    summary: 'A future event used to verify static preview safety.',
    startsAt: '2035-10-20T09:00:00-07:00',
    endsAt: '2035-10-20T12:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Phoenix, Arizona',
    costLabel: 'Free',
    partner: null,
    fundsRaisedCents: null,
    status: 'open',
    capacity: 100,
    registrationOpensAt: null,
    registrationClosesAt: null,
  };

  buildStatic({
    events: [futureEvent],
    now: new Date('2030-01-01T00:00:00Z'),
    outputDirectory,
  });

  const eventPage = fs.readFileSync(
    path.join(outputDirectory, 'events', futureEvent.slug, 'index.html'),
    'utf8'
  );
  const allHtml = readHtmlFiles(outputDirectory);

  assert.match(eventPage, /Registration is closed\./);
  assert.doesNotMatch(allHtml, /(?:href|action)="[^"]*\/register(?:[/?#"])/i);
  assert.doesNotMatch(allHtml, /<form\b/i);
  assert.equal(
    fs.existsSync(path.join(outputDirectory, 'events', futureEvent.slug, 'register')),
    false
  );
});

test('static previews never publish draft events', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-static-draft-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const draftEvent = {
    id: 'evt_unannounced_draft',
    slug: 'unannounced-draft',
    name: 'Unannounced Draft Event',
    summary: 'Internal planning content that must not appear in a public preview.',
    startsAt: '2035-10-20T09:00:00-07:00',
    endsAt: '2035-10-20T12:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Phoenix, Arizona',
    costLabel: 'Free',
    partner: null,
    fundsRaisedCents: null,
    status: 'draft',
    capacity: 100,
    registrationOpensAt: null,
    registrationClosesAt: null,
  };

  buildStatic({
    events: [draftEvent],
    now: new Date('2030-01-01T00:00:00Z'),
    outputDirectory,
  });

  const allHtml = readHtmlFiles(outputDirectory);
  assert.doesNotMatch(allHtml, /Unannounced Draft Event/);
  assert.equal(
    fs.existsSync(path.join(outputDirectory, 'events', draftEvent.slug, 'index.html')),
    false
  );
});

test('static impact excludes cancelled events after their scheduled end', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-static-impact-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const baseEvent = {
    summary: 'A historical event used to verify impact reporting.',
    startsAt: '2029-10-20T09:00:00-07:00',
    endsAt: '2029-10-20T12:00:00-07:00',
    timezone: 'America/Phoenix',
    locationName: 'Phoenix, Arizona',
    costLabel: 'Free',
    partner: null,
    capacity: 100,
    registrationOpensAt: null,
    registrationClosesAt: null,
  };
  const completedEvent = {
    ...baseEvent,
    id: 'evt_completed_impact',
    slug: 'completed-impact-event',
    name: 'Completed Impact Event',
    fundsRaisedCents: 25000,
    status: 'completed',
  };
  const cancelledEvent = {
    ...baseEvent,
    id: 'evt_cancelled_impact',
    slug: 'cancelled-impact-event',
    name: 'Cancelled Impact Event',
    fundsRaisedCents: 90000,
    status: 'cancelled',
  };

  buildStatic({
    events: [completedEvent, cancelledEvent],
    now: new Date('2030-01-01T00:00:00Z'),
    outputDirectory,
  });

  const impactPage = fs.readFileSync(path.join(outputDirectory, 'impact', 'index.html'), 'utf8');
  const eventsPage = fs.readFileSync(path.join(outputDirectory, 'events', 'index.html'), 'utf8');
  assert.match(impactPage, /Completed Impact Event/);
  assert.match(impactPage, /\$250\+/);
  assert.doesNotMatch(impactPage, /Cancelled Impact Event/);
  assert.doesNotMatch(impactPage, /\$900/);
  assert.match(eventsPage, /<h2>Cancelled events<\/h2>/);
  assert.match(eventsPage, /Cancelled Impact Event/);
  assert.match(eventsPage, /<h2>Upcoming<\/h2><span>0 events<\/span>/);
});

test('Vercel previews keep the static site security headers', () => {
  assert.equal(vercelConfig.outputDirectory, 'dist');
  const headerRoute = vercelConfig.routes[0];
  assert.equal(headerRoute.src, '/(.*)');
  assert.equal(headerRoute.continue, true);
  assert.match(headerRoute.headers['Content-Security-Policy'], /form-action 'none'/);
  assert.match(headerRoute.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headerRoute.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headerRoute.headers['X-Frame-Options'], 'DENY');
});

test('Vercel serves the custom 404 for routes that are not static files', () => {
  assert.deepEqual(vercelConfig.routes.slice(1), [
    { handle: 'filesystem' },
    { src: '/(.*)', status: 404, dest: '/404.html' },
  ]);
});

test('foundation build publishes support, verified event content, assets, and no-index preview rules', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-static-foundation-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  buildStatic({
    now: new Date('2026-11-08T12:00:00Z'),
    outputDirectory,
  });

  const home = fs.readFileSync(path.join(outputDirectory, 'index.html'), 'utf8');
  const events = fs.readFileSync(path.join(outputDirectory, 'events', 'index.html'), 'utf8');
  const support = fs.readFileSync(path.join(outputDirectory, 'support', 'index.html'), 'utf8');
  const robots = fs.readFileSync(path.join(outputDirectory, 'robots.txt'), 'utf8');

  assert.match(home, /Bake\. Create\. Connect\. Give back\./);
  assert.match(home, /bake-sale-2026\.jpg/);
  assert.match(events, /Bake Sale for a Better Future/);
  assert.match(support, /Online donations are being connected\./);
  assert.doesNotMatch(support, /zeffy-embed\.js/);
  assert.match(home, /<meta name="robots" content="noindex,nofollow">/);
  assert.equal(robots, 'User-agent: *\nDisallow: /\n');
  assert.equal(fs.existsSync(path.join(outputDirectory, 'images', 'bake-sale-2026.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDirectory, 'images', 'abc-brand-banner.jpg')), true);
});

test('configured Zeffy campaign renders one secure hosted handoff without third-party scripts', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-static-zeffy-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const campaignUrl = 'https://www.zeffy.com/en-US/donation-form/abc?utm_source=website';
  buildStatic({
    now: new Date('2026-11-08T12:00:00Z'),
    outputDirectory,
    siteConfig: {
      instagramUrl: 'https://www.instagram.com/theabc_project/',
      linkedinUrl: 'https://www.linkedin.com/company/autism-bringing-change',
      publicSiteOrigin: '',
      zeffyDonationUrl: campaignUrl,
    },
  });

  const support = fs.readFileSync(path.join(outputDirectory, 'support', 'index.html'), 'utf8');
  const allHtml = readHtmlFiles(outputDirectory);
  assert.equal((support.match(new RegExp(campaignUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.match(support, /Continue securely to Zeffy/);
  assert.doesNotMatch(support, /zeffy-embed\.js|<iframe\b|data-zeffy-embed/i);
  assert.doesNotMatch(allHtml, /<form\b/i);
  assert.doesNotMatch(allHtml, /(?:href|action)="[^"]*\/register(?:[/?#"])/i);
});