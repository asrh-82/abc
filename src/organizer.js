const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CSV_COLUMNS = [
  ['confirmation_code', 'confirmationCode'],
  ['contact_name', 'contactName'],
  ['email', 'email'],
  ['party_size', 'partySize'],
  ['status', 'status'],
  ['created_at', 'createdAt'],
];
const REASON_CODES = new Set([
  'attendee-request',
  'duplicate-registration',
  'event-approved',
  'event-cancelled',
  'event-completed',
  'event-day-check-in',
  'operations-review',
  'other',
  'registration-window-ended',
]);

function requireBoundedText(value, label, { min = 1, max = 200 } = {}) {
  const normalized = String(value || '').trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be between ${min} and ${max} characters.`);
  }
  return normalized;
}

function validateActor(value) {
  return requireBoundedText(value, 'Actor', { min: 2, max: 120 });
}

function validateReason(value) {
  const reason = String(value || '').trim();
  if (!REASON_CODES.has(reason)) {
    throw new Error(`Reason must be one of: ${[...REASON_CODES].join(', ')}.`);
  }
  return reason;
}

function validateEventStatus(value) {
  const status = String(value || '').trim();
  if (!['open', 'closed', 'completed', 'cancelled'].includes(status)) {
    throw new Error('Status must be open, closed, completed, or cancelled.');
  }
  return status;
}

function neutralizeSpreadsheetFormula(value) {
  const stringValue = String(value ?? '');
  return /^\s*[=+\-@]/.test(stringValue) || /^[\t\r]/.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
}

function csvCell(value) {
  return `"${neutralizeSpreadsheetFormula(value).replaceAll('"', '""')}"`;
}

function registrationsToCsv(rows) {
  if (!Array.isArray(rows)) throw new Error('Registration rows must be an array.');
  const lines = [CSV_COLUMNS.map(([, heading]) => csvCell(heading)).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function openOwnerOnly(filename, { exclusive = false } = {}) {
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filename, flags, 0o600);
  fs.fchmodSync(descriptor, 0o600);
  return descriptor;
}

function removeIfPresent(filename) {
  try {
    fs.unlinkSync(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function writeAuditedRegistrationCsv({ outputPath, rows, force = false, recordAudit }) {
  if (typeof recordAudit !== 'function') throw new TypeError('recordAudit must be a function.');
  const destination = path.resolve(outputPath);
  const parent = path.dirname(destination);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing && existing.isDirectory()) {
    const error = new Error('The output path is a directory.');
    error.code = 'EISDIR';
    throw error;
  }

  let reservedDestination = false;
  let stagedPath = null;
  try {
    if (!force) {
      const reservation = openOwnerOnly(destination, { exclusive: true });
      fs.closeSync(reservation);
      reservedDestination = true;
    }

    stagedPath = path.join(
      parent,
      `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    const descriptor = openOwnerOnly(stagedPath, { exclusive: true });
    try {
      fs.writeFileSync(descriptor, registrationsToCsv(rows), { encoding: 'utf8' });
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    recordAudit();
    fs.renameSync(stagedPath, destination);
    stagedPath = null;
    reservedDestination = false;
    return destination;
  } catch (error) {
    if (stagedPath) removeIfPresent(stagedPath);
    if (reservedDestination) removeIfPresent(destination);
    throw error;
  }
}

module.exports = {
  registrationsToCsv,
  validateActor,
  validateEventStatus,
  validateReason,
  writeAuditedRegistrationCsv,
};
