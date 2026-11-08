const fs = require('node:fs');
const path = require('node:path');

const { loadEventManifest, validateEventManifest } = require('../src/event-manifest');
const { splitEvents } = require('../src/services');
const {
  eventDetailPage,
  eventsPage,
  homePage,
  impactPage,
  notFoundPage,
  privacyPage,
} = require('../src/views/pages');

const projectRoot = path.resolve(__dirname, '..');
const defaultOutputDirectory = path.join(projectRoot, 'dist');

function toDatabaseRow(event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    summary: event.summary,
    starts_at: event.startsAt,
    ends_at: event.endsAt || null,
    timezone: event.timezone,
    location_name: event.locationName,
    cost_label: event.costLabel,
    partner: event.partner,
    funds_raised_cents: event.fundsRaisedCents,
    status: event.status,
    capacity: event.capacity,
    registration_opens_at: event.registrationOpensAt,
    registration_closes_at: event.registrationClosesAt,
    reserved: 0,
  };
}

function closeRegistrationForStaticPreview(event) {
  if (event.registrationState === 'completed' || event.registrationState === 'cancelled') {
    return event;
  }

  return {
    ...event,
    registrationOpen: false,
    registrationState: 'closed',
  };
}

function writePage(outputDirectory, relativePath, contents) {
  const destination = path.join(outputDirectory, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function buildStatic({
  now = new Date(),
  events = loadEventManifest(path.join(projectRoot, 'data', 'events.json'), { now }),
  outputDirectory = defaultOutputDirectory,
} = {}) {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  const validatedEvents = validateEventManifest(events, { now });
  const publicEvents = validatedEvents.filter((event) => event.status !== 'draft');
  const splitCollections = splitEvents(publicEvents.map(toDatabaseRow), now);
  const collections = {
    upcoming: splitCollections.upcoming.map(closeRegistrationForStaticPreview),
    past: splitCollections.past.map(closeRegistrationForStaticPreview),
    cancelled: splitCollections.cancelled.map(closeRegistrationForStaticPreview),
  };

  writePage(outputDirectory, 'index.html', homePage(collections));
  writePage(outputDirectory, 'events/index.html', eventsPage(collections));
  writePage(
    outputDirectory,
    'impact/index.html',
    impactPage(collections.past.filter((event) => event.status === 'completed'))
  );
  writePage(outputDirectory, 'privacy/index.html', privacyPage());
  writePage(outputDirectory, '404.html', notFoundPage());

  for (const event of [
    ...collections.upcoming,
    ...collections.cancelled,
    ...collections.past,
  ]) {
    writePage(outputDirectory, `events/${event.slug}/index.html`, eventDetailPage(event));
  }

  fs.copyFileSync(path.join(projectRoot, 'public', 'styles.css'), path.join(outputDirectory, 'styles.css'));
  fs.copyFileSync(path.join(projectRoot, 'public', 'favicon.svg'), path.join(outputDirectory, 'favicon.svg'));

  return 5 + collections.upcoming.length + collections.cancelled.length + collections.past.length;
}

if (require.main === module) {
  const pageCount = buildStatic();
  console.log(`Built ${pageCount} public pages.`);
}

module.exports = { buildStatic };
