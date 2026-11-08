# ABC launch checklist

Any Vercel deployment from Phase 4A is a static preview. It must keep registration closed, omit registration forms and routes, and never receive attendee data.

Public registration on Vercel is blocked until canonical data is on managed PostgreSQL and organizers use real authenticated accounts with authorization and MFA. The Phase 4A CLI is an interim tool for controlled local operations, not a replacement for those gates.

## Vercel preview gate

- Run `npm run events:validate`, `npm test`, `npm run check`, and `npm run build` before publishing a preview.
- Confirm the build output is `dist` and `vercel.json` does not deploy the Express registration server.
- For any future event in a preview, verify the site says registration is closed.
- Verify the static output contains no registration form, `/register` page, or link that appears to accept a registration.
- Review event name, start and end time, timezone, location, cost, partner wording, and navigation on mobile and desktop.
- When no event is confirmed, keep the impact-first state and do not invent a date, registration link, or placeholder event.

## Event manifest workflow

- Give each new event a stable `id` and lowercase kebab-case `slug`; do not reuse either value.
- Include an ISO 8601 `startsAt` and `endsAt` with `Z` or a numeric UTC offset. The offset must match the event's IANA timezone at that instant, including DST. Only a completed historical event may use `null` for `endsAt`.
- Confirm registration open/close timestamps are internally consistent and do not extend past the event start.
- Confirm capacity, cost, location, partner, and fundraising values against an approved source.
- Validate and inspect the proposed synchronization before writing to the database:

  ```bash
  npm run events:validate
  npm run events:sync -- --dry-run
  npm run events:sync
  ```

- Treat a slug-change rejection as a content migration that needs review; do not work around it by assigning an existing slug to another event.
- Treat `data/events.json` as the source for Vercel-visible status. SQLite status controls only the local registration service, and the audited database command does not deploy Vercel.
- Remember that synchronization is non-destructive and does not overwrite an existing event's operational status. Its output must list any manifest/database status differences.
- Confirm the dry run names each proposed event and field change. It must open an existing migrated ABC database read-only; if it creates or migrates a file, stop and investigate.
- Backfill `endsAt` for any database-only future public event. The server intentionally refuses to start while an open or closed future record lacks an end time.
- Run `npm run events:status-check` before sharing a Vercel preview. Resolve missing records, draft/cancelled/completed conflicts, and any manifest-closed/database-open conflict. Consciously review a manifest-open/database-closed warning.
- For a newly approved event: sync reviewed draft metadata, make the audited local database transition, update the manifest status in the reviewed Git change, run the status check, then build and deploy the preview.
- For an emergency cancellation: stop local registration first, immediately mirror `cancelled` in the manifest, run the status check, and redeploy the public site.

## Organizer operations

- Point `DATABASE_PATH` at the intended database before running any organizer command.
- Verify the resolved `Database:` path printed before every organizer operation. A valid but unintended ABC database will pass the identity check.
- Verify `npm run db:migrate` has initialized that exact path. Other organizer commands must reject missing or non-ABC databases without modifying them.
- Review event totals with `npm run registrations:summary -- --event <slug>`.
- Change the local registration database status with `npm run db:event-status -- --event <slug> --status <open|closed|completed|cancelled> --actor <operator> --reason <reason-code>`. Review the one-way transition rules first; this command does not change the public Vercel site.
- Cancel a registration with `npm run registration:cancel -- --code <confirmation-code> --actor <operator> --reason <reason-code>`, then verify the summary shows the released spots.
- Export attendees only when operationally necessary with `npm run registrations:export -- --event <slug> --out <path> --actor <operator> --reason <reason-code>`.
- Confirm each status change, cancellation, and export creates an audit record. Repeated no-op cancellations or status changes should not create a second mutation record.
- Treat `--actor` as audit provenance only. It does not authenticate or authorize the operator; access to the machine and database is the current security boundary.
- Use only the documented non-PII reason codes. Never put a participant name, email address, confirmation code, or free-form note in audit metadata.

## CSV and attendee-data handling

- Use an approved encrypted destination that only authorized event staff can access.
- Keep the export command's owner-only file permissions. Do not loosen permissions or upload the file to a public/shared location.
- Do not pass `--force` unless replacing the exact existing file is intentional and approved.
- Never commit an export, attendee email, confirmation code, or registration database to Git.
- Delete each export as soon as its event-day purpose and any approved retention requirement are complete.
- Keep request bodies, email addresses, confirmation codes, registration payloads, and Turnstile tokens out of logs and analytics.

## Public registration blockers

- Provision managed PostgreSQL for events, registrations, idempotency records, and organizer audit records.
- Migrate and verify capacity transactions, cancellation behavior, event synchronization, audit integrity, retention, backups, and restoration against PostgreSQL.
- Add organization-owned organizer accounts, authorization checks, MFA, session protection, access review, and account-recovery procedures.
- Expose summary, export, status, and cancellation operations only through authenticated and authorized organizer access.
- Configure `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME`; registration must fail closed when any value is missing.
- Keep CSRF protection, server-side Turnstile validation, bounded inputs, exact-retry protection, capacity transactions, rate limiting, and no-store responses.
- Enable upstream WAF and request monitoring before publishing a capped event.
- Review the privacy notice with the organization responsible for the site, including Turnstile processing, organizer access, export handling, and retention periods.
- Decide whether reservations require email confirmation before consuming capacity. Do not claim that confirmation or update emails exist until they are implemented and tested.

## Content and event operations

- Confirm the event's name, start and end time, timezone, location, cost, capacity, registration window, and partner wording with the event owner.
- Decide how fees are collected: online checkout, at the event, or by manual follow-up. Update registration and confirmation copy to match the real process.
- Assign an organizer who can monitor registrations, respond to attendee questions, cancel mistaken or abusive registrations, and close registration quickly.
- Use only ABC-owned or explicitly licensed photography, with recorded permission where participants are identifiable.
- Approve attendee-facing privacy, cancellation, accessibility, contact, and confirmation copy before launch.

## Infrastructure and cutover

- Run a patched Node.js release that satisfies `>=22.13.0`; CI checks the minimum and Node 24.
- Configure encrypted PostgreSQL backups whose retention matches the approved data-retention window, and complete a restore drill.
- Schedule and verify registration-data pruning against event `endsAt`, with `startsAt` used only for eligible historical records that lack an end time.
- Verify the apex and `www` DNS records, TLS certificate, and canonical-host redirect before changing public traffic.
- Smoke-test `/health`, event listing and detail responses, one successful staging registration, one exact retry, one full-event response, one cancellation, one secure export, and one retention run.
- Verify the end-to-end staging flow uses PostgreSQL and authenticated organizer access; a successful static Vercel preview is not sufficient.
- Keep the previous release available for application rollback, but never restore stale registration data over newer canonical data.
