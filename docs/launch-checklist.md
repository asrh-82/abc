# Phase 3 launch checklist

Do not open public registration until every required item below has an owner and has been verified in staging.

## Content and event operations

- Confirm the next event's name, start time, timezone, location, cost, capacity, registration window, and partner wording.
- Decide how fees are collected: online checkout, at the event, or by manual follow-up. Update the registration and confirmation copy to match the real process.
- Confirm who monitors registrations and can promptly cancel abusive or mistaken reservations.
- Use only ABC-owned or explicitly licensed photography, with recorded permission where participants are identifiable.

## Registration protection and privacy

- Configure `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME`. Registration stays closed if any value is missing.
- Enable upstream WAF and request monitoring before publishing a capped event.
- Review the privacy notice with the organization responsible for the site, including Cloudflare Turnstile processing and the registration-data retention period.
- Keep request bodies, email addresses, confirmation codes, and Turnstile tokens out of logs and analytics.
- If five verified registrations of up to ten spots each is too much exposure, implement expiring pending reservations with email confirmation before opening capacity.

## Runtime and data

- Run a patched Node.js release that satisfies `>=22.13.0`; CI checks the minimum and Node 24.
- Run one application instance while SQLite is canonical.
- Mount `DATABASE_PATH` on durable storage. Provision its directory as service-owned `0700`; verify the database, WAL, and SHM files are `0600`.
- Configure encrypted backups whose retention does not exceed the registration-retention window, and complete a restore drill.
- Set `TRUST_PROXY=loopback` only when a same-host reverse proxy supplies the client IP.
- Schedule `npm run db:prune` daily in addition to the in-process retention task.

## Domain cutover

- Verify the apex and `www` DNS records, TLS certificate, and canonical-host redirect before changing public traffic.
- Smoke-test `/health`, the event list, one successful staging registration, one exact retry, one full-event response, and one cancellation.
- Keep the previous release available for rollback, but never restore a stale copy of the registration database over newer production data.
