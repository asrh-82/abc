'use strict';

const ZEFFY_HOSTS = new Set(['www.zeffy.com', 'zeffy.com']);
const INSTAGRAM_HOSTS = new Set(['www.instagram.com', 'instagram.com']);
const LINKEDIN_URL = 'https://www.linkedin.com/company/autism-bringing-change';
const INSTAGRAM_URL = 'https://www.instagram.com/theabc_project/';

class SiteConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SiteConfigError';
  }
}

function optionalHttpsUrl(value, { label, hosts = null } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new SiteConfigError(`${label} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new SiteConfigError(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new SiteConfigError(`${label} must not contain credentials.`);
  }
  if (hosts && !hosts.has(parsed.hostname.toLowerCase())) {
    throw new SiteConfigError(`${label} must use an approved host.`);
  }
  parsed.hash = '';
  return parsed.toString();
}

function loadSiteConfig(env = process.env) {
  const zeffyDonationUrl = optionalHttpsUrl(env.ZEFFY_DONATION_URL, {
    label: 'ZEFFY_DONATION_URL',
    hosts: ZEFFY_HOSTS,
  });

  const instagramUrl = optionalHttpsUrl(env.INSTAGRAM_URL || INSTAGRAM_URL, {
    label: 'INSTAGRAM_URL',
    hosts: INSTAGRAM_HOSTS,
  });
  const publicSiteOrigin = optionalHttpsUrl(env.PUBLIC_SITE_ORIGIN, {
    label: 'PUBLIC_SITE_ORIGIN',
  });
  if (publicSiteOrigin) {
    const parsedOrigin = new URL(String(env.PUBLIC_SITE_ORIGIN).trim());
    if (parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.port) {
      throw new SiteConfigError('PUBLIC_SITE_ORIGIN must contain only an HTTPS origin with no path, query, fragment, or custom port.');
    }
  }

  return Object.freeze({
    instagramUrl,
    linkedinUrl: LINKEDIN_URL,
    publicSiteOrigin: publicSiteOrigin ? new URL(publicSiteOrigin).origin : '',
    zeffyDonationUrl,
  });
}

module.exports = {
  INSTAGRAM_URL,
  LINKEDIN_URL,
  SiteConfigError,
  loadSiteConfig,
  optionalHttpsUrl,
};
