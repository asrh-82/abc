const { escapeHtml } = require('../http');

function logo() {
  return `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

function navLink(href, label, activePath, className = '') {
  const current = activePath === href || (href !== '/' && activePath.startsWith(href));
  return `<a${className ? ` class="${className}"` : ''} href="${href}"${current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
}

function socialLinks(siteConfig = {}) {
  const links = [];
  if (siteConfig.instagramUrl) {
    links.push(`<a href="${escapeHtml(siteConfig.instagramUrl)}" rel="noopener">Instagram</a>`);
  }
  if (siteConfig.linkedinUrl) {
    links.push(`<a href="${escapeHtml(siteConfig.linkedinUrl)}" rel="noopener">LinkedIn</a>`);
  }
  if (!links.length) return '';
  return `<div class="footer-socials" aria-label="ABC social media">${links.join('')}</div>`;
}

function page({
  title,
  description,
  activePath = '',
  canonicalPath = activePath || '/',
  noIndex = false,
  head = '',
  body,
  siteConfig = {},
}) {
  const fullTitle = title === 'Home' ? 'Autism: Bringing Change' : `${title} | Autism: Bringing Change`;
  const canonicalUrl = siteConfig.publicSiteOrigin && !noIndex && canonicalPath
    ? `${siteConfig.publicSiteOrigin}${canonicalPath === '/' ? '' : canonicalPath}`
    : '';
  const canonicalMeta = canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">`
    : '';
  const robotsMeta = noIndex || !siteConfig.publicSiteOrigin
    ? '<meta name="robots" content="noindex,nofollow">'
    : '<meta name="robots" content="index,follow">';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#17315b">
  ${robotsMeta}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Autism: Bringing Change">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta name="twitter:card" content="summary">
  ${canonicalMeta}
  <title>${escapeHtml(fullTitle)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  ${head}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <div class="color-rail" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="/" aria-label="Autism: Bringing Change home">
        ${logo()}
        <span>Autism: Bringing Change</span>
      </a>
      <nav class="desktop-nav" aria-label="Primary navigation">
        <a href="/#about">About</a>
        ${navLink('/events', 'Events', activePath)}
        ${navLink('/impact', 'Impact', activePath)}
        ${navLink('/support', 'Support ABC', activePath, 'nav-support')}
      </nav>
      <details class="mobile-nav">
        <summary aria-label="Open navigation">Menu</summary>
        <nav aria-label="Mobile navigation">
          <a href="/#about">About</a>
          ${navLink('/events', 'Events', activePath)}
          ${navLink('/impact', 'Impact', activePath)}
          ${navLink('/support', 'Support ABC', activePath)}
        </nav>
      </details>
    </div>
  </header>
  <main id="main-content">${body}</main>
  <footer class="site-footer">
    <div class="footer-wave" aria-hidden="true"></div>
    <div class="shell footer-grid">
      <div>
        <a class="brand footer-brand" href="/">${logo()}<span>Autism: Bringing Change</span></a>
        <p>Student-led in Arizona. Built around inclusion, service, and community action.</p>
        ${socialLinks(siteConfig)}
      </div>
      <div class="footer-nav">
        <p class="footer-label">Explore</p>
        <a href="/#about">About ABC</a>
        <a href="/events">Events</a>
        <a href="/impact">Our impact</a>
        <a href="/support">Support ABC</a>
      </div>
      <div class="footer-contact">
        <p class="footer-label">Get in touch</p>
        <a href="mailto:autismbringingchange@gmail.com">autismbringingchange@gmail.com</a>
        <a href="tel:+14808756570">(480) 875-6570</a>
      </div>
    </div>
    <div class="shell footer-bottom">
      <span>&copy; ${new Date().getUTCFullYear()} Autism: Bringing Change</span>
      <a href="/privacy">Privacy</a>
    </div>
  </footer>
</body>
</html>`;
}

module.exports = { page };
