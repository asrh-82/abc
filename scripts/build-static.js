const fs = require('node:fs');
const path = require('node:path');

const { loadEventManifest, validateEventManifest } = require('../src/event-manifest');
const { splitEvents } = require('../src/services');
const { loadSiteConfig } = require('../src/site-config');
const {
  eventDetailPage,
  eventsPage,
  homePage,
  impactPage,
  notFoundPage,
  privacyPage,
  supportPage,
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
  siteConfig = loadSiteConfig(process.env),
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

  writePage(outputDirectory, 'index.html', homePage(collections, { siteConfig }));
  writePage(outputDirectory, 'events/index.html', eventsPage(collections, { siteConfig }));
  writePage(
    outputDirectory,
    'impact/index.html',
    impactPage(collections.past.filter((event) => event.status === 'completed'), { siteConfig })
  );
  writePage(outputDirectory, 'support/index.html', supportPage({ siteConfig }));
  writePage(outputDirectory, 'privacy/index.html', privacyPage(30, { siteConfig }));
  writePage(outputDirectory, '404.html', notFoundPage({ siteConfig }));

  for (const event of [
    ...collections.upcoming,
    ...collections.cancelled,
    ...collections.past,
  ]) {
    writePage(
      outputDirectory,
      `events/${event.slug}/index.html`,
      eventDetailPage(event, { siteConfig })
    );
  }

  fs.copyFileSync(path.join(projectRoot, 'public', 'styles.css'), path.join(outputDirectory, 'styles.css'));
  fs.copyFileSync(path.join(projectRoot, 'public', 'favicon.svg'), path.join(outputDirectory, 'favicon.svg'));
  const imageSource = path.join(projectRoot, 'public', 'images');
  if (fs.existsSync(imageSource)) {
    fs.cpSync(imageSource, path.join(outputDirectory, 'images'), { recursive: true });
  }

  const publicPaths = [
    '/',
    '/events',
    '/impact',
    '/support',
    '/privacy',
    ...[
      ...collections.upcoming,
      ...collections.cancelled,
      ...collections.past,
    ].map((event) => `/events/${encodeURIComponent(event.slug)}`),
  ];
  if (siteConfig.publicSiteOrigin) {
    writePage(
      outputDirectory,
      'sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths.map((publicPath) => `  <url><loc>${siteConfig.publicSiteOrigin}${publicPath === '/' ? '' : publicPath}</loc></url>`).join('\n')}\n</urlset>\n`
    );
    writePage(
      outputDirectory,
      'robots.txt',
      `User-agent: *\nAllow: /\nSitemap: ${siteConfig.publicSiteOrigin}/sitemap.xml\n`
    );
  } else {
    writePage(outputDirectory, 'robots.txt', 'User-agent: *\nDisallow: /\n');
  }

  return 6 + collections.upcoming.length + collections.cancelled.length + collections.past.length;
}

if (require.main === module) {
  const pageCount = buildStatic();
  console.log(`Built ${pageCount} public pages.`);
}

module.exports = { buildStatic };
