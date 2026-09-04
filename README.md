# Autism: Bringing Change

ABC's public event and impact website. Phase 4A keeps event publishing deliberate: event data is validated before it is synchronized, organizer operations are available through local commands, and every Vercel deployment is a static preview with registration forced closed.

The Express registration service and `/api/v1` contract remain in the repository for local development and the future production application. They are not deployed by the current Vercel configuration.

## Vercel previews

`npm run build` writes the static site to `dist`, and `vercel.json` publishes that directory. The static build:

- forces every future event's registration state to `closed`;
- does not emit registration forms or `/register` pages; and
- is suitable for reviewing content, layout, links, and event details only.

Do not use a Vercel preview to collect registrations. Public registration on Vercel remains blocked until the application uses managed PostgreSQL and real organizer authentication with MFA.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm start
```

The local server creates `var/abc.sqlite`, applies additive migrations, and synchronizes the checked-in event manifest without deleting database-only events or overwriting an existing event's operational status. Runtime registration data stays out of Git and is pruned 30 days after each event by default.

Set `DATABASE_PATH` to use another SQLite file. The organizer commands and local server must point to the same database file.

## Event manifest workflow

`data/events.json` is the reviewed event manifest. Each event has a stable `id` and an immutable `slug`. Future events require an explicit `endsAt`; `endsAt` may be `null` only for a completed event that has already started.

Phase 4A deliberately has two status authorities because Vercel cannot read the local SQLite database:

| Concern | Authority | What changes it |
| --- | --- | --- |
| Public visibility and lifecycle on Vercel | `data/events.json` in Git | A reviewed commit followed by a Vercel deployment |
| Registration acceptance in the local Express service | SQLite `events.status` | The audited `db:event-status` command |
| Public website release | Git plus Vercel | `npm run build`, then a Vercel preview or production deployment |

The database status command does not publish the website. Vercel previews are static and always force registration closed, even when the manifest says an event is open.

Every timestamp must include `Z` or a numeric UTC offset that matches the event's IANA `timezone` at that instant. The check is DST-aware, so an offset copied from the wrong season fails validation instead of shifting the displayed local time.

Validate every edit before synchronizing it:

```bash
npm run events:validate
npm run events:sync -- --dry-run
npm run events:sync
```

The dry run requires an existing, fully migrated ABC database and opens it read-only. It prints the exact event IDs and changed field names; it never creates or migrates a database. For a new database, run `npm run db:migrate` first and verify the printed path before syncing.

Synchronization is idempotent. It inserts new stable IDs, updates reviewed descriptive and scheduling fields, leaves unchanged records alone, and never treats a missing manifest entry as an instruction to delete a database record. It rejects ID/slug conflicts, refuses to reduce capacity below confirmed attendance, and does not overwrite the operational status of an existing event. Sync output reports any manifest/database status difference instead of hiding it. A legacy database-only future event without `endsAt` blocks server startup until its end time is backfilled or the record is returned to draft.

Before sharing a Vercel preview, compare the two status authorities without writing to either one:

```bash
npm run events:status-check
```

The check fails on missing records, publication-significant differences involving draft, cancelled, or completed events, and any case where the manifest is closed but the local registration database remains open. Manifest `open` with database `closed` is a warning because an organizer may intentionally close local registration while the event remains publicly listed. Resolve or consciously review every warning before deployment.

For a newly approved event, synchronize its reviewed draft metadata, make the audited local database transition, change the manifest to the matching public status in the reviewed Git change, run the status check, and then build the Vercel preview. For an emergency cancellation, close the local registration service first, immediately mirror `cancelled` in the manifest, rerun the check, and redeploy the public site.

## Organizer commands

Run these commands only from a trusted machine with access to the intended `DATABASE_PATH`:

```bash
# Read event registration totals and remaining capacity.
npm run registrations:summary -- --event community-tennis-tournament

# Create a private, Git-ignored export directory once.
mkdir -m 700 -p ./exports

# Export attendee records. Add --force only when replacing the exact output file is intentional.
npm run registrations:export -- \
  --event community-tennis-tournament \
  --out ./exports/tennis-registrations.csv \
  --actor "organizer@example.org" \
  --reason event-day-check-in

# Cancel one registration by confirmation code and release its spots.
npm run registration:cancel -- \
  --code ABC-EXAMPLE \
  --actor "organizer@example.org" \
  --reason attendee-request

# Change only the local registration database through an audited transition.
npm run db:event-status -- \
  --event community-tennis-tournament \
  --status closed \
  --actor "organizer@example.org" \
  --reason registration-window-ended
```

Status transitions are deliberately one-way: a reviewed draft may open; an open event may close, complete after its end time, or cancel; a closed event may complete or cancel. Completed and cancelled events cannot be reversed, and closed events cannot be reopened through this command.

Every organizer command prints the resolved database path before it reads or changes data. Verify that line before continuing; ABC database identity checks cannot distinguish the intended production copy from another valid ABC database.

Status changes, cancellations, and exports create audit records. `--actor` records provenance; it does **not** authenticate the person running the command. Filesystem and database access are the current security boundary, so these commands are not a substitute for organizer sign-in or MFA.

`--reason` accepts a non-PII code: `attendee-request`, `duplicate-registration`, `event-approved`, `event-cancelled`, `event-completed`, `event-day-check-in`, `operations-review`, `other`, or `registration-window-ended`. Do not place names, email addresses, confirmation codes, or free-form notes in audit metadata.

Organizer commands require an existing database with ABC's application identity. They reject missing or unrelated SQLite files before schema or data changes; `npm run db:migrate` is the only command that initializes or upgrades a database.

CSV exports contain names, email addresses, confirmation codes, and registration details. The export command creates files with owner-only permissions and refuses to overwrite an existing file unless `--force` is provided. Store exports in an approved encrypted location, share them only with authorized event staff, and delete them as soon as they are no longer needed.

## Other checks

```bash
npm test
npm run check
npm run build
npm run db:migrate
npm run db:prune
```

## Public API

- `GET /api/v1/events?scope=upcoming|past|all`
- `GET /api/v1/events/:slug`
- `POST /api/v1/events/:slug/registrations`

Registration responses never expose the attendee list. Exact network retries are deduplicated with a random UUIDv4 idempotency key; separate submissions may share an email so the API never becomes an event-participation lookup. The checked-in contract is at `docs/openapi.json`.

The API is available from the local Express service, not from the current static Vercel deployment.

## Production gates

The current SQLite service is for local development and controlled single-instance evaluation. It is not safe as canonical registration storage on Vercel's stateless runtime.

Before public registration opens:

- move event, registration, and audit data to managed PostgreSQL with encrypted backups and a tested restore path;
- add organization-owned organizer accounts, authorization, and MFA;
- preserve server-side Turnstile verification, CSRF protection, capacity transactions, idempotency, rate limiting, and data retention;
- provide authenticated organizer access to summaries, exports, event status, and registration cancellation; and
- complete the content, privacy, infrastructure, and domain checks in `docs/launch-checklist.md`.

For any controlled non-Vercel evaluation of the current server, copy `.env.example` into the deployment environment and provide a Cloudflare Turnstile site key, secret, and expected hostname. The server reports registration as closed until all three settings are configured, regardless of `NODE_ENV`.

Turnstile setup follows Cloudflare's [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) and [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) requirements.
