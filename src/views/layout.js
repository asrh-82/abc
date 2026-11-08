const { escapeHtml } = require('../http');

function logo() {
  return `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

function navLink(href, label, activePath) {
  const current = activePath === href || (href !== '/' && activePath.startsWith(href));
  return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
}

function page({ title, description, activePath = '', head = '', body }) {
  const fullTitle = title === 'Home' ? 'Autism: Bringing Change' : `${title} | Autism: Bringing Change`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#102a43">
  <title>${escapeHtml(fullTitle)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  ${head}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="/" aria-label="Autism: Bringing Change home">
        ${logo()}
        <span>Autism: Bringing Change</span>
      </a>
      <nav class="desktop-nav" aria-label="Primary navigation">
        <a href="/#about">About</a>
        ${navLink('/events', 'Events', activePath)}
        ${navLink('/impact', 'Our impact', activePath)}
        <a class="nav-contact" href="mailto:autismbringingchange@gmail.com">Contact</a>
      </nav>
      <details class="mobile-nav">
        <summary aria-label="Open navigation">Menu</summary>
        <nav aria-label="Mobile navigation">
          <a href="/#about">About</a>
          ${navLink('/events', 'Events', activePath)}
          ${navLink('/impact', 'Our impact', activePath)}
          <a href="mailto:autismbringingchange@gmail.com">Contact</a>
        </nav>
      </details>
    </div>
  </header>
  <main id="main-content">${body}</main>
  <footer class="site-footer">
    <div class="shell footer-grid">
      <div>
        <a class="brand footer-brand" href="/">${logo()}<span>Autism: Bringing Change</span></a>
        <p>A youth-led Phoenix initiative supporting autism therapy through community events.</p>
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
