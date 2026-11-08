# ABC product roadmap

## Phase 3 — Registration foundation

- Fast event discovery and a three-action path from event to confirmation.
- Minimal registration data: contact name, email, and spot count.
- Transactional capacity checks, exact-retry protection, CSRF protection, a honeypot, bounded validation, and server-verified Turnstile before capacity is consumed.
- SQLite persistence with migrations and runtime data excluded from Git.
- Versioned event and registration endpoints for later mobile clients.
- Honest event state: an event cannot remain open after it is complete.

## Phase 4A — Safe event operations

- Publish Vercel previews as static builds only. Registration is forced closed and registration forms/routes are omitted from preview output.
- Validate `data/events.json` before use, including stable IDs, immutable slugs, timestamps with offsets, registration windows, capacity, and duplicate detection.
- Synchronize the manifest idempotently by stable ID. Existing operational status is preserved, database-only events are not deleted, and ID/slug collisions fail atomically.
- Track `endsAt` separately from `startsAt`. It may be `null` only for historical completed events; future events require an explicit end time.
- Provide local organizer commands for event summaries, secure CSV export, registration cancellation, and audited one-way database status changes without claiming that SQLite publishes Vercel.
- Define `data/events.json` as the Vercel-visible status authority, report database/manifest drift during sync, and add a read-only pre-preview status consistency gate.
- Audit status changes, registration cancellations, and exports without copying attendee personal data into the audit detail.
- Treat CSV exports as sensitive personal data: create them with owner-only permissions, prevent accidental overwrite by default, limit access, and delete them promptly after use.

The CLI's required `--actor` value records who the operator says they are; it is provenance, not authentication. Phase 4A therefore improves controlled operations but does not satisfy the security bar for a public registration deployment.

## Phase 4B — Public registration readiness

- Move canonical event, registration, and audit storage to managed PostgreSQL before serving registration on Vercel.
- Add organization-owned organizer accounts, role-based authorization, and MFA.
- Provide an authenticated organizer interface for event publishing, summaries, exports, status changes, and registration cancellation.
- Add confirmation and update emails that do not block a successful registration.
- Document encrypted backup retention, restoration, incident response, and access review.
- Keep public registration blocked until managed PostgreSQL and real organizer authentication with MFA are both verified.

## Phase 5 — Payments and event-day tools

- Decide between online payment and pay-at-event before integrating checkout.
- Store payment status separately from registration status.
- Add waitlists, cancellation links, and QR check-in only if event operations require them.

## Phase 6 — iOS client

- Build against the stable `/api/v1` contract rather than connecting the app directly to the database.
- Reuse events, capacity, registration, cancellation, and confirmation behavior from the website.
- Add accounts, saved attendee profiles, and push notifications only if they remove real repeat-user friction.
- Reuse the managed PostgreSQL-backed service established for public web registration.
