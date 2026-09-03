const crypto = require('node:crypto');
const { escapeHtml, formatEventDate, formatMoney } = require('../http');
const { page } = require('./layout');

function eventDateBlock(event) {
  const date = formatEventDate(event);
  return `<time class="date-block" datetime="${escapeHtml(event.startsAt)}">
    <span>${escapeHtml(date.month)}</span>
    <strong>${escapeHtml(date.day)}</strong>
  </time>`;
}

function eventMeta(event, { compact = false } = {}) {
  const date = formatEventDate(event);
  return `<dl class="event-meta${compact ? ' event-meta-compact' : ''}">
    <div><dt>Date</dt><dd>${escapeHtml(date.fullDate)}</dd></div>
    <div><dt>Time</dt><dd>${escapeHtml(date.time)}</dd></div>
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
    <a class="text-link" href="/events/${encodeURIComponent(event.slug)}">${past ? 'View recap' : 'View details'} <span aria-hidden="true">→</span></a>
  </article>`;
}

function homePage({ upcoming, past }) {
  const nextEvent = upcoming.find((event) => event.status !== 'cancelled') || null;
  const latestPast = past.find((event) => event.status === 'completed') || null;
  const nextEventAction = nextEvent?.registrationOpen ? 'View event and register' : 'View event details';
  const nextEventPanel = nextEvent
    ? `<aside class="next-event" aria-label="Next event">
        <p class="eyebrow">Next event</p>
        <div class="next-event-heading">${eventDateBlock(nextEvent)}<h2>${escapeHtml(nextEvent.name)}</h2></div>
        <p>${escapeHtml(nextEvent.locationName)}</p>
        <a class="button button-sun" href="/events/${encodeURIComponent(nextEvent.slug)}">${nextEventAction}</a>
      </aside>`
    : `<aside class="next-event next-event-quiet" aria-label="Event status">
        <p class="eyebrow">Next event</p>
        <h2>We’re planning what comes next.</h2>
        <p>The latest listed event has ended. See what ABC has already brought to the community.</p>
        <a class="button button-sun" href="/events">Explore all events</a>
      </aside>`;

  const body = `
  <section class="hero">
    <div class="shell hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">Youth-led in Phoenix, Arizona</p>
        <h1>Community events that fund autism therapy.</h1>
        <p class="hero-lede">Autism: Bringing Change brings families, students, and supporters together around events with a direct purpose.</p>
        <div class="hero-actions">
          <a class="button button-light" href="/events">Find an event</a>
          <a class="text-link text-link-light" href="/impact">See our impact <span aria-hidden="true">→</span></a>
        </div>
      </div>
      ${nextEventPanel}
    </div>
  </section>
  <section class="purpose-section">
    <div class="shell purpose-grid">
      <div>
        <p class="eyebrow eyebrow-dark">How ABC events work</p>
        <h2>See the details. Reserve a spot. Show up.</h2>
      </div>
      <ol class="process-list">
        <li><span>01</span><div><strong>Choose an event</strong><p>See the date, location, cost, and available spots before you commit.</p></div></li>
        <li><span>02</span><div><strong>Reserve your spot</strong><p>A short registration keeps the process simple for families and participants.</p></div></li>
        <li><span>03</span><div><strong>Attend the event</strong><p>Your participation helps ABC raise money for autism therapy.</p></div></li>
      </ol>
    </div>
  </section>
  ${latestPast ? `<section class="latest-section"><div class="shell section-grid">
    <div>
      <p class="eyebrow eyebrow-dark">Latest completed event</p>
      <h2>${escapeHtml(latestPast.name)}</h2>
      <p>${escapeHtml(latestPast.summary)}</p>
    </div>
    <div class="latest-details">
      ${eventMeta(latestPast, { compact: true })}
      <a class="button button-dark" href="/events/${encodeURIComponent(latestPast.slug)}">View the event recap</a>
    </div>
  </div></section>` : ''}`;

  return page({
    title: 'Home',
    description: 'Autism: Bringing Change is a youth-led Phoenix initiative supporting autism therapy through community events.',
    activePath: '/',
    body,
  });
}

function eventsPage({ upcoming, past }) {
  const upcomingMarkup = upcoming.length
    ? upcoming.map((event) => eventRow(event)).join('')
    : `<div class="empty-state">
        <p class="eyebrow eyebrow-dark">No registration open today</p>
        <h2>The next event is being planned.</h2>
        <p>ABC will publish the date, location, cost, and signup here as soon as they are confirmed.</p>
        <a class="text-link" href="mailto:autismbringingchange@gmail.com">Ask about upcoming events <span aria-hidden="true">→</span></a>
      </div>`;

  const body = `<header class="page-intro"><div class="shell intro-grid">
      <div><p class="eyebrow eyebrow-dark">Events</p><h1>Everything you need before you register.</h1></div>
      <p>See the date, time, location, cost, and availability up front. When registration opens, one short form reserves your spot.</p>
    </div></header>
    <section class="events-section"><div class="shell">
      <div class="section-heading"><h2>Upcoming</h2><span>${upcoming.length} listed</span></div>
      <div class="event-list">${upcomingMarkup}</div>
    </div></section>
    <section class="events-section events-past"><div class="shell">
      <div class="section-heading"><h2>Past events</h2><span>${past.length} documented</span></div>
      <div class="event-list">${past.map((event) => eventRow(event, { past: true })).join('')}</div>
    </div></section>`;

  return page({
    title: 'Events',
    description: 'Browse upcoming and completed Autism: Bringing Change community events in the Phoenix area.',
    activePath: '/events',
    body,
  });
}

function eventDetailPage(event, { notice = '' } = {}) {
  const closedMessages = {
    not_yet_open: ['Registration opens soon.', 'Check back when the registration window begins.'],
    full: ['This event is full.', 'Registration has reached the available capacity.'],
    closed: ['Registration is closed.', 'Explore current listings to find another ABC event.'],
    completed: ['This event has ended.', 'Explore current listings to find the next ABC event.'],
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
        <a class="button button-dark" href="/events">View all events</a>
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
    body,
  });
}

function registrationPage(
  event,
  { csrfToken, values = {}, errors = {}, turnstileSiteKey = '' } = {}
) {
  const date = formatEventDate(event);
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
          <p><strong>${escapeHtml(date.fullDate)}</strong><br>${escapeHtml(date.time)}</p>
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
    head: turnstileSiteKey
      ? '<link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : '',
    body,
  });
}

function confirmationPage(registration, { duplicate = false } = {}) {
  const date = formatEventDate({ startsAt: registration.starts_at, timezone: registration.timezone });
  const cancelled =
    registration.status === 'cancelled' || registration.event_status === 'cancelled';
  const body = `<section class="confirmation-section"><div class="shell confirmation-card">
      <div class="confirmation-mark" aria-hidden="true">${cancelled ? '×' : '✓'}</div>
      <p class="eyebrow eyebrow-dark">${cancelled ? 'Registration cancelled' : duplicate ? 'Registration already received' : 'You’re registered'}</p>
      <h1>${escapeHtml(registration.event_name)}</h1>
      <p class="confirmation-lede">${cancelled ? 'These spots are no longer reserved. Contact ABC if this does not look right.' : duplicate ? 'We found your existing reservation and kept it unchanged.' : 'Your spots are reserved. Save the confirmation code below.'}</p>
      <dl class="confirmation-details">
        <div><dt>When</dt><dd>${escapeHtml(date.fullDate)} at ${escapeHtml(date.time)}</dd></div>
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
    body,
  });
}

function impactPage(past) {
  const recordedRaised = past.reduce((total, event) => total + (event.fundsRaisedCents || 0), 0);
  const partnerNames = [...new Set(past.map((event) => event.partner).filter(Boolean))];
  const body = `<header class="page-intro impact-intro"><div class="shell intro-grid">
      <div><p class="eyebrow eyebrow-dark">Our impact</p><h1>The work so far.</h1></div>
      <p>ABC’s public record starts with the work: the events held, the community partners involved, and the funds documented for autism therapy.</p>
    </div></header>
    <section class="impact-summary"><div class="shell impact-stat-grid">
      <div><strong>${past.length}</strong><span>events documented</span></div>
      <div><strong>${partnerNames.length}</strong><span>community partner groups</span></div>
      <div><strong>${escapeHtml(recordedRaised > 0 ? `${formatMoney(recordedRaised)}+` : '$0')}</strong><span>recorded for autism therapy</span></div>
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
    </div></section>`;

  return page({
    title: 'Our impact',
    description: 'See the community events and recorded fundraising behind Autism: Bringing Change.',
    activePath: '/impact',
    body,
  });
}

function privacyPage(retentionDays = 30) {
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
      <h2>Questions or deletion requests</h2>
      <p>Email <a href="mailto:autismbringingchange@gmail.com">autismbringingchange@gmail.com</a> to ask what information is held about your registration or request deletion.</p>
    </article>`;
  return page({
    title: 'Privacy',
    description: 'How Autism: Bringing Change handles event registration information.',
    activePath: '/privacy',
    body,
  });
}

function notFoundPage() {
  return page({
    title: 'Page not found',
    description: 'The requested page could not be found.',
    body: `<section class="error-page shell"><p class="eyebrow eyebrow-dark">404</p><h1>That page isn’t here.</h1><p>Head back to the event list or the ABC homepage.</p><div><a class="button button-dark" href="/events">View events</a><a class="text-link" href="/">Go home <span aria-hidden="true">→</span></a></div></section>`,
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
};
