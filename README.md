# Autism: Bringing Change

ABC's public event and impact website. Phase 3 adds a short event-registration flow and a versioned API that a future iOS app can reuse.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm start
```

The server creates `var/abc.sqlite`, applies additive migrations, and seeds the documented events only when the event table is empty. Runtime registration data stays out of Git and is pruned 30 days after each event by default.

## Useful commands

```bash
npm run dev
npm test
npm run check
npm run db:migrate
npm run db:seed
```

Set `DATABASE_PATH` to move the SQLite database outside the repository. Production should use a durable mounted path with automated encrypted backups.

Copy `.env.example` into your deployment environment and provide a Cloudflare Turnstile site key, secret, and expected hostname. The running server deliberately reports registration as closed until all three settings are configured, regardless of `NODE_ENV`; automated tests inject an isolated verifier instead of weakening runtime behavior.

## Public API

- `GET /api/v1/events?scope=upcoming|past|all`
- `GET /api/v1/events/:slug`
- `POST /api/v1/events/:slug/registrations`

Registration responses never expose the attendee list. Exact network retries are deduplicated with a random UUIDv4 idempotency key; separate submissions may share an email so the API never becomes an event-participation lookup. The web app and future clients share the same registration service, capacity rules, and database.

The checked-in contract is at `docs/openapi.json`.

## Production notes

- Run one application instance while SQLite is the source of truth.
- Keep the database on durable storage and back it up on a schedule. Provision its directory for the service account only (`0700`); the application entry points enforce a restrictive process umask and `0600` database files.
- Put TLS and request-rate protection in front of the Node server.
- Configure Cloudflare Turnstile for the `event-registration` action, set the expected production hostname, and keep its secret on the server. Verification is enforced server-side before a reservation consumes capacity.
- Before publishing an event with scarce capacity, enable upstream WAF monitoring and confirm who can promptly cancel abusive registrations. If verified anonymous reservations are still too risky, Phase 4 should move new reservations into a pending state until email confirmation.
- Set `TRUST_PROXY=loopback` when a same-host reverse proxy such as Nginx supplies the client IP. Leave it unset for direct traffic; never trust arbitrary forwarded addresses.
- Schedule `npm run db:prune` daily as a second layer behind the in-process retention job, and keep encrypted backup retention at or below the registration-retention window.
- Do not log request bodies or registration payloads.
- Move to managed PostgreSQL before horizontal scaling or a native-app launch that materially increases traffic.

Turnstile setup follows Cloudflare's [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) and [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) requirements.

Use `docs/launch-checklist.md` for the content, privacy, infrastructure, and domain gates that must be cleared before public registration opens.
