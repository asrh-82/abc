const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INSTAGRAM_URL,
  SiteConfigError,
  loadSiteConfig,
} = require('../src/site-config');

test('site configuration supplies verified social defaults and keeps giving optional', () => {
  const config = loadSiteConfig({});

  assert.equal(config.instagramUrl, INSTAGRAM_URL);
  assert.equal(config.zeffyDonationUrl, '');
  assert.equal(config.publicSiteOrigin, '');
});

test('site configuration accepts approved Zeffy URLs and normalizes the public origin', () => {
  const config = loadSiteConfig({
    ZEFFY_DONATION_URL: 'https://www.zeffy.com/en-US/donation-form/abc?utm_source=website',
    PUBLIC_SITE_ORIGIN: 'https://autismbringingchange.xyz/',
  });

  assert.equal(
    config.zeffyDonationUrl,
    'https://www.zeffy.com/en-US/donation-form/abc?utm_source=website'
  );
  assert.equal(config.publicSiteOrigin, 'https://autismbringingchange.xyz');
});

for (const [label, environment] of [
  ['non-HTTPS URL', { ZEFFY_DONATION_URL: 'http://www.zeffy.com/donation-form/abc' }],
  ['unapproved host', { ZEFFY_DONATION_URL: 'https://zeffy.example/donation-form/abc' }],
  ['embedded credentials', { ZEFFY_DONATION_URL: 'https://user:pass@www.zeffy.com/donation-form/abc' }],
  ['malformed URL', { ZEFFY_DONATION_URL: 'not a url' }],
  ['origin path', { PUBLIC_SITE_ORIGIN: 'https://autismbringingchange.xyz/events' }],
  ['origin query', { PUBLIC_SITE_ORIGIN: 'https://autismbringingchange.xyz/?preview=1' }],
  ['origin fragment', { PUBLIC_SITE_ORIGIN: 'https://autismbringingchange.xyz/#home' }],
  ['origin custom port', { PUBLIC_SITE_ORIGIN: 'https://autismbringingchange.xyz:8443/' }],
]) {
  test(`site configuration rejects ${label}`, () => {
    assert.throws(() => loadSiteConfig(environment), SiteConfigError);
  });
}
