const fs = require('node:fs');
const path = require('node:path');

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
const outputDirectory = path.join(projectRoot, 'dist');
const events = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'data', 'events.json'), 'utf8')
);

function toDatabaseRow(event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    summary: event.summary,
    starts_at: event.startsAt,
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

function writePage(relativePath, contents) {
  const destination = path.join(outputDirectory, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

const collections = splitEvents(events.map(toDatabaseRow), new Date());
writePage('index.html', homePage(collections));
writePage('events/index.html', eventsPage(collections));
writePage('impact/index.html', impactPage(collections.past));
writePage('privacy/index.html', privacyPage());
writePage('404.html', notFoundPage());

for (const event of [...collections.upcoming, ...collections.past]) {
  writePage(`events/${event.slug}/index.html`, eventDetailPage(event));
}

fs.copyFileSync(path.join(projectRoot, 'public', 'styles.css'), path.join(outputDirectory, 'styles.css'));
fs.copyFileSync(path.join(projectRoot, 'public', 'favicon.svg'), path.join(outputDirectory, 'favicon.svg'));

console.log(`Built ${5 + collections.upcoming.length + collections.past.length} public pages.`);
