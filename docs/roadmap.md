# ABC product roadmap

## Phase 3 — Registration foundation

- Fast event discovery and a three-action path from event to confirmation.
- Minimal registration data: contact name, email, and spot count.
- Transactional capacity checks, exact-retry protection, CSRF protection, a honeypot, bounded validation, and server-verified Turnstile before capacity is consumed.
- SQLite persistence with migrations and runtime data excluded from Git.
- Versioned event and registration endpoints for later mobile clients.
- Honest event state: listings with a past date cannot remain open by accident.

## Phase 4 — Organizer operations

- Protected organizer sign-in with organization-owned accounts and MFA.
- Create, edit, publish, close, and cancel events without editing source files.
- Attendee totals and CSV export with audit logging.
- Confirmation and update emails that do not block a successful registration.
- Protected access, attendee export, and a documented restore process.

## Phase 5 — Payments and event-day tools

- Decide between online payment and pay-at-event before integrating checkout.
- Payment status stored separately from registration status.
- Waitlists, cancellation links, and QR check-in only if event operations require them.

## Phase 6 — iOS client

- Build against the stable `/api/v1` contract rather than connecting the app directly to the database.
- Reuse events, capacity, registration, and confirmation behavior from the website.
- Add accounts, saved attendee profiles, and push notifications only if they remove real repeat-user friction.
- Move the canonical database to managed PostgreSQL before scaling beyond one server instance.
