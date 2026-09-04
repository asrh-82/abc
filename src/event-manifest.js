'use strict';

const fs = require('node:fs');

const EVENT_STATUSES = new Set([
  'draft',
  'open',
  'closed',
  'cancelled',
  'completed',
]);

const STRING_FIELDS = {
  id: { max: 80 },
  slug: { max: 100 },
  name: { max: 160 },
  summary: { max: 600 },
  timezone: { max: 100 },
  locationName: { max: 200 },
  costLabel: { max: 80 },
  partner: { max: 160 },
};

const EVENT_FIELDS = new Set([
  ...Object.keys(STRING_FIELDS),
  'startsAt',
  'endsAt',
  'status',
  'capacity',
  'fundsRaisedCents',
  'registrationOpensAt',
  'registrationClosesAt',
]);

const STABLE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):([0-5]\d))$/;
const TIMEZONE_OFFSET_FORMATTERS = new Map();

class EventManifestValidationError extends Error {
  constructor(issues) {
    const details = issues.map((issue) => `- ${issue}`).join('\n');
    super(`Event manifest validation failed:\n${details}`);
    this.name = 'EventManifestValidationError';
    this.issues = [...issues];
  }
}

function addIssue(issues, path, message) {
  issues.push(`${path}: ${message}`);
}

function normalizeRequiredString(event, field, path, issues, { nullable = false } = {}) {
  const value = event[field];
  if (nullable && value === null) return null;
  if (typeof value !== 'string') {
    addIssue(issues, `${path}.${field}`, nullable ? 'must be a string or null.' : 'must be a string.');
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    addIssue(issues, `${path}.${field}`, 'must not be empty.');
    return null;
  }

  const { max } = STRING_FIELDS[field];
  if (normalized.length > max) {
    addIssue(issues, `${path}.${field}`, `must be ${max} characters or fewer.`);
    return null;
  }

  return normalized;
}

function normalizeIanaTimezone(value, path, issues) {
  if (!value) return null;
  if (value !== 'UTC' && !value.includes('/')) {
    addIssue(issues, path, 'must be an IANA timezone such as "America/Phoenix".');
    return null;
  }

  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions()
      .timeZone;
    if (canonical !== 'UTC' && !canonical.includes('/')) {
      addIssue(issues, path, 'must resolve to an IANA timezone.');
      return null;
    }
    return canonical;
  } catch {
    addIssue(issues, path, `"${value}" is not a recognized IANA timezone.`);
    return null;
  }
}

function normalizeTimestamp(value, path, issues, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    addIssue(issues, path, 'is required.');
    return null;
  }
  if (typeof value !== 'string') {
    addIssue(issues, path, 'must be an ISO 8601 string with a Z or numeric UTC offset.');
    return null;
  }

  const normalized = value.trim();
  const match = ISO_TIMESTAMP_PATTERN.exec(normalized);
  if (!match) {
    addIssue(
      issues,
      path,
      'must use ISO 8601 date-time format and include a timezone (for example, 2026-10-18T07:30:00-07:00).'
    );
    return null;
  }

  const [, yearText, monthText, dayText, , , , , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    addIssue(issues, path, 'contains an invalid calendar date.');
    return null;
  }

  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0)) {
      addIssue(issues, path, 'contains a UTC offset outside the ISO 8601 range of ±14:00.');
      return null;
    }
  }

  if (!Number.isFinite(Date.parse(normalized))) {
    addIssue(issues, path, 'is not a valid ISO 8601 timestamp.');
    return null;
  }

  return normalized;
}

function timestampOffsetMinutes(timestamp) {
  const match = ISO_TIMESTAMP_PATTERN.exec(timestamp);
  if (match[8] === 'Z') return 0;
  const direction = match[9] === '-' ? -1 : 1;
  return direction * (Number(match[10]) * 60 + Number(match[11]));
}

function timezoneOffsetMinutes(timezone, instantMs) {
  let formatter = TIMEZONE_OFFSET_FORMATTERS.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    TIMEZONE_OFFSET_FORMATTERS.set(timezone, formatter);
  }

  const label = formatter
    .formatToParts(new Date(instantMs))
    .find((part) => part.type === 'timeZoneName')?.value;
  if (label === 'GMT' || label === 'UTC') return 0;

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label || '');
  if (!match) return null;
  const direction = match[1] === '-' ? -1 : 1;
  return direction * (Number(match[2]) * 60 + Number(match[3]));
}

function formatOffset(minutes) {
  const direction = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const remainder = String(absolute % 60).padStart(2, '0');
  return `${direction}${hours}:${remainder}`;
}

function validateTimestampTimezone(timestamp, timezone, path, issues) {
  if (timestamp === null || timezone === null) return;

  const declaredOffset = timestampOffsetMinutes(timestamp);
  const expectedOffset = timezoneOffsetMinutes(timezone, Date.parse(timestamp));
  if (expectedOffset === null) {
    addIssue(issues, path, `could not determine the UTC offset for ${timezone} at that instant.`);
    return;
  }
  if (declaredOffset !== expectedOffset) {
    addIssue(
      issues,
      path,
      `uses UTC offset ${formatOffset(declaredOffset)}, but ${timezone} uses ${formatOffset(expectedOffset)} at that instant.`
    );
  }
}

function normalizeNullableInteger(value, path, issues, { positive = false } = {}) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) {
    addIssue(issues, path, 'must be a safe integer or null.');
    return null;
  }
  if (positive ? value <= 0 : value < 0) {
    addIssue(issues, path, positive ? 'must be a positive integer or null.' : 'must be a nonnegative integer or null.');
    return null;
  }
  return value;
}

function normalizeNow(value) {
  const now = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError('options.now must be a valid Date or timestamp.');
  }
  return now;
}

function normalizeEvent(event, index, now, issues) {
  const path = `events[${index}]`;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    addIssue(issues, path, 'must be an object.');
    return null;
  }

  for (const field of Object.keys(event)) {
    if (!EVENT_FIELDS.has(field)) {
      addIssue(issues, `${path}.${field}`, 'is not a supported event field.');
    }
  }

  const strings = {};
  for (const field of Object.keys(STRING_FIELDS)) {
    strings[field] = normalizeRequiredString(event, field, path, issues, {
      nullable: field === 'partner',
    });
  }
  strings.timezone = normalizeIanaTimezone(strings.timezone, `${path}.timezone`, issues);

  if (strings.id && !STABLE_ID_PATTERN.test(strings.id)) {
    addIssue(
      issues,
      `${path}.id`,
      'must use lowercase letters, numbers, underscores, or hyphens and start and end with a letter or number.'
    );
  }
  if (strings.slug && !SLUG_PATTERN.test(strings.slug)) {
    addIssue(issues, `${path}.slug`, 'must be a lowercase kebab-case slug.');
  }

  const status = event.status;
  if (typeof status !== 'string' || !EVENT_STATUSES.has(status)) {
    addIssue(
      issues,
      `${path}.status`,
      `must be one of: ${[...EVENT_STATUSES].join(', ')}.`
    );
  }

  const startsAt = normalizeTimestamp(event.startsAt, `${path}.startsAt`, issues);
  const endsAt = normalizeTimestamp(event.endsAt, `${path}.endsAt`, issues, { nullable: true });
  const registrationOpensAt = normalizeTimestamp(
    event.registrationOpensAt,
    `${path}.registrationOpensAt`,
    issues,
    { nullable: true }
  );
  const registrationClosesAt = normalizeTimestamp(
    event.registrationClosesAt,
    `${path}.registrationClosesAt`,
    issues,
    { nullable: true }
  );
  const capacity = normalizeNullableInteger(event.capacity, `${path}.capacity`, issues, {
    positive: true,
  });
  const fundsRaisedCents = normalizeNullableInteger(
    event.fundsRaisedCents,
    `${path}.fundsRaisedCents`,
    issues
  );

  const startsAtMs = startsAt === null ? null : Date.parse(startsAt);
  const endsAtMs = endsAt === null ? null : Date.parse(endsAt);
  const registrationOpensAtMs =
    registrationOpensAt === null ? null : Date.parse(registrationOpensAt);
  const registrationClosesAtMs =
    registrationClosesAt === null ? null : Date.parse(registrationClosesAt);

  validateTimestampTimezone(startsAt, strings.timezone, `${path}.startsAt`, issues);
  validateTimestampTimezone(endsAt, strings.timezone, `${path}.endsAt`, issues);
  validateTimestampTimezone(
    registrationOpensAt,
    strings.timezone,
    `${path}.registrationOpensAt`,
    issues
  );
  validateTimestampTimezone(
    registrationClosesAt,
    strings.timezone,
    `${path}.registrationClosesAt`,
    issues
  );

  if (startsAtMs !== null && endsAtMs !== null && endsAtMs <= startsAtMs) {
    addIssue(issues, `${path}.endsAt`, 'must be later than startsAt.');
  }
  if (
    startsAtMs !== null &&
    endsAt === null &&
    !(status === 'completed' && startsAtMs <= now.getTime())
  ) {
    addIssue(
      issues,
      `${path}.endsAt`,
      'may be null only for a completed event whose start time is at or before the validation time.'
    );
  }
  const effectiveEndMs = endsAtMs ?? startsAtMs;
  if (status === 'completed' && effectiveEndMs !== null && effectiveEndMs > now.getTime()) {
    addIssue(
      issues,
      `${path}.status`,
      'cannot be completed until endsAt (or startsAt when no end is recorded) is at or before the validation time.'
    );
  }

  if (
    registrationOpensAtMs !== null &&
    registrationClosesAtMs !== null &&
    registrationOpensAtMs >= registrationClosesAtMs
  ) {
    addIssue(issues, `${path}.registrationOpensAt`, 'must be earlier than registrationClosesAt.');
  }
  if (registrationOpensAtMs !== null && startsAtMs !== null && registrationOpensAtMs >= startsAtMs) {
    addIssue(issues, `${path}.registrationOpensAt`, 'must be earlier than startsAt.');
  }
  if (registrationClosesAtMs !== null && startsAtMs !== null && registrationClosesAtMs > startsAtMs) {
    addIssue(issues, `${path}.registrationClosesAt`, 'must be earlier than or equal to startsAt.');
  }

  return {
    id: strings.id,
    slug: strings.slug,
    name: strings.name,
    summary: strings.summary,
    startsAt,
    endsAt,
    timezone: strings.timezone,
    locationName: strings.locationName,
    costLabel: strings.costLabel,
    partner: strings.partner,
    fundsRaisedCents,
    status,
    capacity,
    registrationOpensAt,
    registrationClosesAt,
  };
}

function validateEventArray(events, options = {}) {
  if (!Array.isArray(events)) {
    throw new EventManifestValidationError(['events: top-level value must be an array.']);
  }

  const now = normalizeNow(options.now);
  const issues = [];
  const normalized = events.map((event, index) => normalizeEvent(event, index, now, issues));
  const seenIds = new Map();
  const seenSlugs = new Map();

  normalized.forEach((event, index) => {
    if (!event) return;
    if (event.id) {
      if (seenIds.has(event.id)) {
        addIssue(
          issues,
          `events[${index}].id`,
          `duplicates events[${seenIds.get(event.id)}].id ("${event.id}").`
        );
      } else {
        seenIds.set(event.id, index);
      }
    }
    if (event.slug) {
      if (seenSlugs.has(event.slug)) {
        addIssue(
          issues,
          `events[${index}].slug`,
          `duplicates events[${seenSlugs.get(event.slug)}].slug ("${event.slug}").`
        );
      } else {
        seenSlugs.set(event.slug, index);
      }
    }
  });

  if (issues.length > 0) throw new EventManifestValidationError(issues);
  return normalized;
}

function validateEventManifest(input, options = {}) {
  if (Array.isArray(input)) return validateEventArray(input, options);
  if (typeof input !== 'string') {
    throw new EventManifestValidationError([
      'events: manifest input must be a JSON string or an array of event objects.',
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new EventManifestValidationError([`events: manifest is not valid JSON (${error.message}).`]);
  }
  return validateEventArray(parsed, options);
}

function loadEventManifest(filePath, options = {}) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new EventManifestValidationError([
      `events: could not read manifest at "${filePath}" (${error.message}).`,
    ]);
  }
  return validateEventManifest(source, options);
}

const parseEventManifest = validateEventManifest;

module.exports = {
  EventManifestValidationError,
  loadEventManifest,
  parseEventManifest,
  validateEventManifest,
};
