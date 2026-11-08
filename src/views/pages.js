const crypto = require('node:crypto');
const { escapeHtml, formatEventDate, formatEventSchedule, formatMoney } = require('../http');
const { page } = require('./layout');

const BAKE_SALE_POST_URL = 'https://www.instagram.com/theabc_project/p/DeFROTLv1Q6/';

function eventDateBlock(event) {
  const date = formatEventDate(event);
  return `<time class="date-block" datetime="${escapeHtml(event.startsAt)}" aria-label="${escapeHtml(date.fullDate)}">
    <span>${escapeHtml(date.month)}</span>
    <strong>${escapeHtml(date.day)}</strong>
    <small>${escapeHtml(date.year)}</small>
  </time>`;
}

function eventMeta(event, { compact = false } = {}) {
  const schedule = formatEventSchedule(event);
  return `<dl class="event-meta${compact ? ' event-meta-compact' : ''}">
    <div><dt>Date</dt><dd>${escapeHtml(schedule.date)}</dd></div>
    <div><dt>Time</dt><dd>${escapeHtml(schedule.time)}</dd></div>
    <div><dt>Location</dt><dd>${escapeHtml(event.locationName)}</dd></div>
    <div><dt>Cost</dt><dd>${escapeHtml(event.costLabel)}</dd></div>
  </dl>`;
}

function statusLabel(event) {
  const labels = {
    open: ['Registration open', ' status-open'],
    not_yet_open: ['Registration opens soon', ''],
    full: ['Event full', ''],
    closed: ['Registration closed', ''],
    completed: ['Event complete', ''],
    cancelled: ['Cancelled', ''],
  };
  const [label, className] = labels[event.registrationState] || labels.closed;
  return `<span class="status${className}">${label}</span>`;
}

function eventRow(event, { past = false } = {}) {
  const date = formatEventDate(event);
  return `<article class="event-row">
    ${eventDateBlock(event)}
    <div class="event-row-main">
      <div class="event-row-heading">
        ${statusLabel(event)}
        <h3><a href="/events/${encodeURIComponent(event.slug)}">${escapeHtml(event.name)}</a></h3>
      </div>
      <p>${escapeHtml(event.summary)}</p>
      <p class="event-line">${escapeHtml(date.time)} <span aria-hidden="true">·</span> ${escapeHtml(event.locationName)}</p>
      ${past && event.fundsRaisedCents !== null ? `<p class="raised">${escapeHtml(formatMoney(event.fundsRaisedCents))} raised</p>` : ''}
    </div>
    <a class="text-link" href="/events/${encodeURIComponent(event.slug)}">View details <span aria-hidden="true">→</span></a>
  </article>`;
}

function homePage({ upcoming, past }, { siteConfig = {} } = {}) {
  const nextEvent = upcoming[0] || null;
  const latestPast = past.find((event) => event.status === 'completed') || null;
  const completedEvents = past.filter((event) => event.status === 'completed');
  const recordedRaised = completedEvents.reduce(
    (total, event) => total + (event.fundsRaisedCents || 0),
    0
  );
  const eventRibbon = nextEvent
    ? `<div class="event-ribbon" aria-label="Next event">
        <span>Next event</span>
        <strong>${escapeHtml(nextEvent.name)}</strong>
        <a href="/events/${encodeURIComponent(nextEvent.slug)}">${nextEvent.registrationOpen ? 'Details and registration' : 'Event details'} <span aria-hidden="true">→</span></a>
      </div>`
    : `<div class="event-ribbon event-ribbon-quiet" aria-label="Current event status">
        <span>Event update</span>
        <strong>No registration is open right now.</strong>
        <a href="/events#past-events">Explore past events <span aria-hidden="true">→</span></a>
      </div>`;

  const body = `
  <section class="hero">
    <div class="shell hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">Student-led in Arizona</p>
        <h1>Community experiences that make belonging real.</h1>
        <p class="hero-lede">Autism: Bringing Change creates inclusive events, service projects, and local partnerships for autistic individuals and their families.</p>
        <div class="hero-actions">
          <a class="button button-blue" href="/support">Support the work</a>
          <a class="text-link" href="/events">See what ABC has done <span aria-hidden="true">→</span></a>
        </div>
        ${eventRibbon}
      </div>
      <div class="hero-art">
        <span class="shape shape-sky" aria-hidden="true"></span>
        <span class="shape shape-yellow" aria-hidden="true"></span>
        <span class="shape shape-red" aria-hidden="true"></span>
        <div class="hero-proof">
          <strong>200+</strong>
          <span>community participants</span>
          <small>reported by ABC</small>
        </div>
        <img src="/images/abc-brand-banner.jpg" width="744" height="126" alt="Autism: Bringing Change. Building Blocks for a Better Future.">
      </div>
    </div>
  </section>
  <section class="story-section">
    <div class="shell story-intro">
      <div>
        <p class="eyebrow eyebrow-dark">How change takes shape</p>
        <h2>Built by people showing up together.</h2>
      </div>
      <p>From the court to the trail, each ABC project gives students, families, volunteers, and community partners a real way to take part.</p>
    </div>
    <ol class="shell story-stream">
      <li class="story-step story-step-blue"><span>01</span><div><h3>Gather</h3><p>ABC creates welcoming spaces through basketball, hiking, tennis, pickleball, and community events.</p></div></li>
      <li class="story-step story-step-yellow"><span>02</span><div><h3>Partner</h3><p>Local organizations bring experience, volunteers, venues, and reach to every project.</p></div></li>
      <li class="story-step story-step-red"><span>03</span><div><h3>Keep building</h3><p>Service projects, sensory-kit outreach, and student leadership carry the work beyond one event.</p></div></li>
    </ol>
  </section>
  <section class="about-section" id="about"><div class="shell about-grid">
    <div class="about-heading">
      <p class="eyebrow">About ABC</p>
      <h2>Students turning inclusion into action.</h2>
    </div>
    <div class="about-copy">
      <p>ABC is an Arizona nonprofit led by students. The team works with schools, nonprofits, businesses, and community groups to build awareness, create inclusive experiences, and make service easier to join.</p>
      <a class="text-link text-link-light" href="/impact">See the full record <span aria-hidden="true">→</span></a>
    </div>
    <dl class="impact-drift" aria-label="ABC impact at a glance">
      <div><dt>Community participants</dt><dd>200+</dd></div>
      <div><dt>Publicly reported partnerships</dt><dd>5</dd></div>
      <div><dt>Events documented here</dt><dd>${completedEvents.length}</dd></div>
      <div><dt>Verified event fundraising</dt><dd>${escapeHtml(recordedRaised > 0 ? `${formatMoney(recordedRaised)}+` : 'Reporting in progress')}</dd></div>
    </dl>
  </div></section>
  <section class="recent-section"><div class="shell recent-grid">
    <figure class="bake-art">
      <span class="bake-art-backdrop" aria-hidden="true"></span>
      <img src="/images/bake-sale-2026.jpg" width="640" height="640" loading="lazy" decoding="async" alt="Colorful Bake Sale for a Better Future artwork from ABC and Chea Youth.">
      <figcaption>October 24, 2026 · with Chea Youth</figcaption>
    </figure>
    <div class="recent-copy">
      <p class="eyebrow eyebrow-dark">Recently at ABC</p>
      <h2>Bake. Create. Connect. Give back.</h2>
      <p>ABC and Chea Youth brought treats, entertainment, interactive stalls, and volunteer opportunities to Aloravita Community for the Bake Sale for a Better Future.</p>
      <a class="text-link" href="${BAKE_SALE_POST_URL}" rel="noopener">See the original Instagram post <span aria-hidden="true">→</span></a>
    </div>
  </div></section>
  ${latestPast ? `<section class="event-spotlight"><div class="shell spotlight-grid">
    <div><p class="eyebrow eyebrow-dark">Latest documented event</p><h2>${escapeHtml(latestPast.name)}</h2><p>${escapeHtml(latestPast.summary)}</p></div>
    <div>${eventMeta(latestPast, { compact: true })}<a class="button button-navy" href="/events/${encodeURIComponent(latestPast.slug)}">View event details</a></div>
  </div></section>` : ''}
  <section class="support-band"><div class="shell support-band-inner">
    <div><p class="eyebrow">Keep the next project moving</p><h2>There is more to build.</h2></div>
    <div><p>Support future community events, outreach, and student-led service through ABC’s secure giving page.</p><a class="button button-light" href="/support">Ways to support ABC</a></div>
  </div></section>`;

  return page({
    title: 'Home',
    description: 'Autism: Bringing Change is a student-led Arizona nonprofit creating inclusive events, service projects, and community partnerships.',
    activePath: '/',
    canonicalPath: '/',
    body,
    siteConfig,
  });
}

function eventsPage({ upcoming, past, cancelled = [] }, { siteConfig = {} } = {}) {
  const hasUpcoming = upcoming.length > 0;
  const upcomingMarkup = upcoming.length
    ? upcoming.map((event) => eventRow(event)).join('')
    : `<div class="empty-state">
        <p class="eyebrow eyebrow-dark">Current status</p>
        <h2>No upcoming event has been announced.</h2>
        <p>ABC is working on what comes next. Once an event is confirmed, its date, location, cost, availability, and signup will all live on this page.</p>
        <a class="text-link" href="mailto:autismbringingchange@gmail.com?subject=ABC%20events">Contact ABC <span aria-hidden="true">→</span></a>
      </div>`;

  const body = `<header class="page-intro"><div class="shell intro-grid">
      <div><p class="eyebrow eyebrow-dark">Events</p><h1>${hasUpcoming ? 'Everything you need before you register.' : 'Past events now. Fast signup when the next one opens.'}</h1></div>
      <p>${hasUpcoming ? 'See the date, time, location, cost, and availability up front. When registration opens, one short form reserves your spot.' : 'Nothing is open for registration today. The full event record stays available below while ABC plans what comes next.'}</p>
    </div></header>
    <section class="events-section"><div class="shell">
      <div class="section-heading"><h2>Upcoming</h2><span>${upcoming.length} ${upcoming.length === 1 ? 'event' : 'events'}</span></div>
      <div class="event-list">${upcomingMarkup}</div>
    </div></section>
    ${cancelled.length ? `<section class="events-section" id="cancelled-events"><div class="shell">
      <div class="section-heading"><h2>Cancelled events</h2><span>${cancelled.length} ${cancelled.length === 1 ? 'event' : 'events'}</span></div>
      <div class="event-list">${cancelled.map((event) => eventRow(event)).join('')}</div>
    </div></section>` : ''}
    <section class="events-section events-past" id="past-events"><div class="shell">
      <div class="section-heading"><h2>Past events</h2><span>${past.length} documented</span></div>
      <div class="event-list">${past.map((event) => eventRow(event, { past: true })).join('')}</div>
    </div></section>`;

  return page({
    title: 'Events',
    description: 'Browse upcoming and completed Autism: Bringing Change community events in the Phoenix area.',
    activePath: '/events',
    canonicalPath: '/events',
    body,
    siteConfig,
  });
}

function eventDetailPage(event, { notice = '', siteConfig = {} } = {}) {
  const closedMessages = {
    not_yet_open: ['Registration opens soon.', 'Check back when the registration window begins.'],
    full: ['This event is full.', 'Registration has reached the available capacity.'],
    closed: ['Registration is closed.', 'Explore current listings to find another ABC event.'],
    completed: ['This event has ended.', 'See ABC’s impact or browse the other completed events.'],
    cancelled: ['This event was cancelled.', 'Explore current listings to find another ABC event.'],
  };
  const closedMessage = closedMessages[event.registrationState] || closedMessages.closed;
  const registrationCard = event.registrationOpen
    ? `<aside class="action-card">
        <p class="eyebrow eyebrow-dark">Registration open</p>
        <h2>${event.remaining === null ? 'Reserve your spot.' : `${event.remaining} spots remaining.`}</h2>
        <p>No account. One short form. You’ll receive your confirmation immediately.</p>
        <a class="button button-sun" href="/events/${encodeURIComponent(event.slug)}/register">Register for this event</a>
      </aside>`
    : `<aside class="action-card action-card-closed">
        <p class="eyebrow eyebrow-dark">${statusLabel(event)}</p>
        <h2>${closedMessage[0]}</h2>
        <p>${closedMessage[1]}</p>
        <a class="button button-dark" href="${event.registrationState === 'completed' ? '/impact' : '/events'}">${event.registrationState === 'completed' ? 'See ABC’s impact' : 'View all events'}</a>
      </aside>`;
  const funds = formatMoney(event.fundsRaisedCents);

  const body = `${notice ? `<div class="notice-bar" role="status"><div class="shell">${escapeHtml(notice)}</div></div>` : ''}<header class="event-hero"><div class="shell event-hero-grid">
      <div>
        <a class="back-link" href="/events"><span aria-hidden="true">←</span> All events</a>
        <div class="event-title-line">${eventDateBlock(event)}<div>${statusLabel(event)}<h1>${escapeHtml(event.name)}</h1></div></div>
        <p class="event-summary">${escapeHtml(event.summary)}</p>
      </div>
      ${registrationCard}
    </div></header>
    <section class="event-detail-section"><div class="shell event-detail-grid">
      <div>
        <p class="eyebrow eyebrow-dark">Event details</p>
        ${eventMeta(event)}
      </div>
      <div class="event-context">
        ${event.partner ? `<div><h2>Community partner</h2><p>${escapeHtml(event.partner)}</p></div>` : ''}
        ${funds ? `<div><h2>Recorded impact</h2><p class="impact-number">${escapeHtml(funds)}</p><p>raised for autism therapy</p></div>` : ''}
      </div>
    </div></section>`;

  return page({
    title: event.name,
    description: event.summary,
    activePath: '/events',
    canonicalPath: `/events/${encodeURIComponent(event.slug)}`,
    body,
    siteConfig,
  });
}

function registrationPage(
  event,
  { csrfToken, values = {}, errors = {}, turnstileSiteKey = '', siteConfig = {} } = {}
) {
  const schedule = formatEventSchedule(event);
  const idempotencyKey = values.idempotencyKey || crypto.randomUUID();
  const maxPartySize = event.remaining === null ? 10 : Math.max(1, Math.min(10, event.remaining));
  const errorSummary = Object.keys(errors).length
    ? `<div class="form-alert" role="alert" tabindex="-1"><strong>Check the highlighted fields.</strong><p>${escapeHtml(errors.form || 'A few details need your attention.')}</p></div>`
    : '';

  const body = `<section class="registration-section"><div class="shell registration-grid">
      <div class="registration-context">
        <a class="back-link" href="/events/${encodeURIComponent(event.slug)}"><span aria-hidden="true">←</span> Event details</a>
        <p class="eyebrow eyebrow-dark">Reserve your spot</p>
        <h1>${escapeHtml(event.name)}</h1>
        <div class="registration-event-summary">
          <p><strong>${escapeHtml(schedule.date)}</strong><br>${escapeHtml(schedule.time)}</p>
          <p>${escapeHtml(event.locationName)}<br>${escapeHtml(event.costLabel)}</p>
        </div>
        <ol class="step-list" aria-label="Registration progress">
          <li class="done"><span>1</span>Event</li>
          <li aria-current="step"><span>2</span>Details</li>
          <li><span>3</span>Done</li>
        </ol>
      </div>
      <form class="registration-form" method="post" action="/events/${encodeURIComponent(event.slug)}/register" novalidate>
        ${errorSummary}
        <div class="form-heading"><h2>Your registration</h2><p>Use an adult contact for participants under 18.</p></div>
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="idempotencyKey" value="${escapeHtml(idempotencyKey)}">
        <div class="honey" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
        <div class="field${errors.contactName ? ' field-error' : ''}">
          <label for="contactName">Contact name</label>
          <input id="contactName" name="contactName" value="${escapeHtml(values.contactName || '')}" autocomplete="name" maxlength="80" required aria-describedby="contactName-help${errors.contactName ? ' contactName-error' : ''}"${errors.contactName ? ' aria-invalid="true"' : ''}>
          <p id="contactName-help" class="field-help">The person ABC should contact about this registration.</p>
          ${errors.contactName ? `<p id="contactName-error" class="error-text">${escapeHtml(errors.contactName)}</p>` : ''}
        </div>
        <div class="field${errors.email ? ' field-error' : ''}">
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="email" maxlength="254" required${errors.email ? ' aria-describedby="email-error" aria-invalid="true"' : ''}>
          ${errors.email ? `<p id="email-error" class="error-text">${escapeHtml(errors.email)}</p>` : ''}
        </div>
        <div class="field${errors.partySize ? ' field-error' : ''}">
          <label for="partySize">Number of spots</label>
          <select id="partySize" name="partySize" required${errors.partySize ? ' aria-describedby="partySize-error" aria-invalid="true"' : ''}>
            ${Array.from({ length: maxPartySize }, (_, index) => index + 1).map((number) => `<option value="${number}"${Number(values.partySize || 1) === number ? ' selected' : ''}>${number}</option>`).join('')}
          </select>
          ${errors.partySize ? `<p id="partySize-error" class="error-text">${escapeHtml(errors.partySize)}</p>` : ''}
        </div>
        <div class="checkbox-field${errors.consent ? ' field-error' : ''}">
          <input id="consent" name="consent" type="checkbox"${values.consent ? ' checked' : ''} required${errors.consent ? ' aria-describedby="consent-error" aria-invalid="true"' : ''}>
          <label for="consent">I confirm the information is accurate and ABC may contact me about this event.</label>
          ${errors.consent ? `<p id="consent-error" class="error-text">${escapeHtml(errors.consent)}</p>` : ''}
        </div>
        ${turnstileSiteKey ? `<div class="turnstile-field"><div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-action="event-registration" data-size="flexible" data-appearance="interaction-only"></div></div>` : ''}
        <button class="button button-sun button-full" type="submit">Complete registration</button>
        <p class="form-footnote">This reserves your requested spots. ABC will send final event and payment details separately.</p>
      </form>
    </div></section>`;

  return page({
    title: `Register for ${event.name}`,
    description: `Reserve a spot for ${event.name}.`,
    activePath: '/events',
    canonicalPath: `/events/${encodeURIComponent(event.slug)}/register`,
    noIndex: true,
    head: turnstileSiteKey
      ? '<link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : '',
    body,
    siteConfig,
  });
}

function confirmationPage(registration, { duplicate = false, siteConfig = {} } = {}) {
  const schedule = formatEventSchedule({
    startsAt: registration.starts_at,
    endsAt: registration.ends_at,
    timezone: registration.timezone,
  });
  const cancelled =
    registration.status === 'cancelled' || registration.event_status === 'cancelled';
  const body = `<section class="confirmation-section"><div class="shell confirmation-card">
      <div class="confirmation-mark" aria-hidden="true">${cancelled ? '×' : '✓'}</div>
      <p class="eyebrow eyebrow-dark">${cancelled ? 'Registration cancelled' : duplicate ? 'Registration already received' : 'You’re registered'}</p>
      <h1>${escapeHtml(registration.event_name)}</h1>
      <p class="confirmation-lede">${cancelled ? 'These spots are no longer reserved. Contact ABC if this does not look right.' : duplicate ? 'We found your existing reservation and kept it unchanged.' : 'Your spots are reserved. Save the confirmation code below.'}</p>
      <dl class="confirmation-details">
        <div><dt>When</dt><dd>${escapeHtml(schedule.date)} · ${escapeHtml(schedule.time)}</dd></div>
        <div><dt>Where</dt><dd>${escapeHtml(registration.location_name)}</dd></div>
        <div><dt>Spots</dt><dd>${registration.party_size}</dd></div>
        <div><dt>Confirmation</dt><dd><code>${escapeHtml(registration.confirmation_code)}</code></dd></div>
      </dl>
      ${cancelled ? '<p>No action is needed unless you want help from the ABC team.</p>' : '<p>ABC will use the email on your registration for final event and payment details.</p>'}
      <div class="confirmation-actions"><a class="button button-dark" href="/events/${encodeURIComponent(registration.event_slug)}">Back to event</a><a class="text-link" href="/events">See all events <span aria-hidden="true">→</span></a></div>
    </div></section>`;

  return page({
    title: 'Registration confirmed',
    description: 'Your Autism: Bringing Change event registration is confirmed.',
    activePath: '/events',
    canonicalPath: '',
    noIndex: true,
    body,
    siteConfig,
  });
}

function impactPage(past, { siteConfig = {} } = {}) {
  const recordedRaised = past.reduce((total, event) => total + (event.fundsRaisedCents || 0), 0);
  const body = `<header class="page-intro impact-intro"><div class="shell intro-grid">
      <div><p class="eyebrow eyebrow-dark">Our impact</p><h1>Small actions becoming shared momentum.</h1></div>
      <p>ABC measures impact through participation, partnerships, service, and the events the community has built together.</p>
    </div></header>
    <section class="impact-summary"><div class="shell impact-stat-grid">
      <div><strong>200+</strong><span>community participants</span></div>
      <div><strong>5</strong><span>publicly reported partnerships</span></div>
      <div><strong>${past.length}</strong><span>completed events documented here</span></div>
      <div><strong>${escapeHtml(recordedRaised > 0 ? `${formatMoney(recordedRaised)}+` : '—')}</strong><span>verified event fundraising recorded here</span></div>
    </div><p class="impact-source">Participation and partnership figures come from ABC’s public organization profile. Fundraising appears only when an event total is verified.</p></section>
    <section class="impact-stories"><div class="shell impact-story-grid">
      <article><span class="story-orb orb-blue" aria-hidden="true"></span><p class="eyebrow eyebrow-dark">Inclusive events</p><h2>Connection through participation.</h2><p>Basketball, hiking, tennis, and pickleball have created welcoming ways for families, students, and supporters to spend time together.</p></article>
      <article><span class="story-orb orb-yellow" aria-hidden="true"></span><p class="eyebrow eyebrow-dark">Practical service</p><h2>Support beyond event day.</h2><p>ABC’s public work includes sensory-kit donations, outreach, and student-led service projects designed around local needs.</p></article>
      <article><span class="story-orb orb-red" aria-hidden="true"></span><p class="eyebrow eyebrow-dark">Recent work</p><h2>A bake sale built for connection.</h2><p>ABC and Chea Youth brought the Bake Sale for a Better Future to Aloravita Community on October 24, 2026, with treats, activities, and volunteer opportunities.</p><a class="text-link" href="${BAKE_SALE_POST_URL}" rel="noopener">View the event post <span aria-hidden="true">→</span></a></article>
    </div></section>
    <section class="impact-timeline"><div class="shell">
      <div class="section-heading"><h2>Event record</h2><span>Newest first</span></div>
      <ol>
        ${past.map((event) => {
          const date = formatEventDate(event);
          const funds = formatMoney(event.fundsRaisedCents);
          return `<li>
            <time datetime="${escapeHtml(event.startsAt)}">${escapeHtml(date.fullDate)}</time>
            <div><h3><a href="/events/${encodeURIComponent(event.slug)}">${escapeHtml(event.name)}</a></h3><p>${escapeHtml(event.locationName)}${event.partner ? ` · with ${escapeHtml(event.partner)}` : ''}</p>${funds ? `<strong>${escapeHtml(funds)} raised</strong>` : ''}</div>
          </li>`;
        }).join('')}
      </ol>
    </div></section>
    <section class="impact-cta"><div class="shell support-band-inner"><div><p class="eyebrow">Add to the momentum</p><h2>Help fund what comes next.</h2></div><div><p>Support ABC’s next event, outreach project, or student-led service effort.</p><a class="button button-light" href="/support">Support ABC</a></div></div></section>`;

  return page({
    title: 'Our impact',
    description: 'See the events, partnerships, service, and verified impact behind Autism: Bringing Change.',
    activePath: '/impact',
    canonicalPath: '/impact',
    body,
    siteConfig,
  });
}

function supportPage({ siteConfig = {} } = {}) {
  let givingMarkup;

  if (siteConfig.zeffyDonationUrl) {
    givingMarkup = `<div class="giving-ready"><p>ABC’s secure giving page is ready on Zeffy. You will finish your donation on Zeffy’s website.</p><a class="button button-blue" href="${escapeHtml(siteConfig.zeffyDonationUrl)}">Continue securely to Zeffy</a></div>`;
  } else {
    givingMarkup = `<div class="giving-pending"><p class="eyebrow eyebrow-dark">Giving page in progress</p><h2>Online donations are being connected.</h2><p>The support page is ready, but ABC has not published its Zeffy campaign link yet. You can still contact the team about supporting an upcoming project.</p><a class="button button-navy" href="mailto:autismbringingchange@gmail.com?subject=Supporting%20ABC">Contact ABC</a></div>`;
  }

  const body = `<header class="support-hero"><div class="shell support-hero-grid">
      <div><p class="eyebrow">Support ABC</p><h1>Help the next idea become a real community project.</h1><p>Donations help ABC organize inclusive events, build outreach projects, and give student volunteers the resources to act.</p></div>
      <div class="support-orbit" aria-hidden="true"><i></i><i></i><i></i><strong>ABC</strong></div>
    </div></header>
    <section class="ways-section"><div class="shell ways-grid">
      <div><span>Give</span><p>Use the secure Zeffy campaign when it is live.</p></div>
      <div><span>Partner</span><p>Bring a venue, expertise, volunteers, or community reach.</p></div>
      <div><span>Participate</span><p>Join an event and help make the space welcoming.</p></div>
    </div></section>
    <section class="giving-section"><div class="shell giving-grid">
      <div class="giving-copy"><p class="eyebrow eyebrow-dark">Secure online giving</p><h2>Support handled by Zeffy.</h2><p>Donation and payment details stay with Zeffy. The ABC website does not receive card information.</p></div>
      <div>${givingMarkup}</div>
    </div></section>
    <section class="support-contact"><div class="shell support-contact-inner"><h2>Want to support ABC another way?</h2><p>For partnerships, in-kind support, volunteering, or event ideas, email <a href="mailto:autismbringingchange@gmail.com">autismbringingchange@gmail.com</a>.</p></div></section>`;

  return page({
    title: 'Support ABC',
    description: 'Support Autism: Bringing Change through secure giving, partnership, volunteering, or participation.',
    activePath: '/support',
    canonicalPath: '/support',
    body,
    siteConfig,
  });
}

function privacyPage(retentionDays = 30, { siteConfig = {} } = {}) {
  const body = `<article class="legal-page shell">
      <p class="eyebrow eyebrow-dark">Privacy</p>
      <h1>Only the details needed to run the event.</h1>
      <p>ABC collects a contact name, email address, and number of spots during registration. This information is used to manage the event and contact registrants about it.</p>
      <h2>What we avoid collecting</h2>
      <p>The registration form does not ask for diagnoses, medical records, payment account details, or attendee profiles.</p>
      <h2>How long registration data is kept</h2>
      <p>Registration records are automatically deleted ${retentionDays} days after the event. The public website does not provide an attendee list.</p>
      <h2>Protection from automated signups</h2>
      <p>When event registration is open, ABC uses Cloudflare Turnstile to protect limited event capacity from bots. Cloudflare processes technical signals such as an IP address, browser and network information, and the site origin to assess whether a submission is automated. Learn more in Cloudflare’s <a href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile Privacy Addendum</a>.</p>
      <h2>Donations through Zeffy</h2>
      <p>When ABC’s donation campaign is active, Zeffy handles donation and payment details. The ABC website does not receive card information. Review <a href="https://www.zeffy.com/privacy">Zeffy’s privacy information</a> before donating.</p>
      <h2>Questions or deletion requests</h2>
      <p>Email <a href="mailto:autismbringingchange@gmail.com">autismbringingchange@gmail.com</a> to ask what information is held about your registration or request deletion.</p>
    </article>`;
  return page({
    title: 'Privacy',
    description: 'How Autism: Bringing Change handles event registration information.',
    activePath: '/privacy',
    canonicalPath: '/privacy',
    body,
    siteConfig,
  });
}

function notFoundPage({ siteConfig = {} } = {}) {
  return page({
    title: 'Page not found',
    description: 'The requested page could not be found.',
    canonicalPath: '',
    noIndex: true,
    body: `<section class="error-page shell"><p class="eyebrow eyebrow-dark">404</p><h1>That page isn’t here.</h1><p>Head back to the event list or the ABC homepage.</p><div><a class="button button-dark" href="/events">View events</a><a class="text-link" href="/">Go home <span aria-hidden="true">→</span></a></div></section>`,
    siteConfig,
  });
}

module.exports = {
  confirmationPage,
  eventDetailPage,
  eventsPage,
  homePage,
  impactPage,
  notFoundPage,
  privacyPage,
  registrationPage,
  supportPage,
};
