const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  registrationsToCsv,
  validateActor,
  validateEventStatus,
  validateReason,
  writeAuditedRegistrationCsv,
} = require('../src/organizer');
const { parseArgs } = require('../scripts/lib/args');

test('registration CSV is RFC 4180-shaped and neutralizes spreadsheet formulas', () => {
  const csv = registrationsToCsv([
    {
      confirmation_code: 'ABC123',
      contact_name: '=IMPORTXML("https://example.com")',
      email: 'person@example.com',
      party_size: 2,
      status: 'confirmed',
      created_at: '2026-09-04T10:00:00.000Z',
    },
    {
      confirmation_code: 'XYZ789',
      contact_name: 'Morgan "Mo" Lee\nParent',
      email: '+malicious@example.com',
      party_size: 1,
      status: 'cancelled',
      created_at: '2026-09-04T11:00:00.000Z',
    },
  ]);

  assert.match(csv, /^"confirmationCode","contactName","email"/);
  assert.match(csv, /"'=IMPORTXML\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /"Morgan ""Mo"" Lee\nParent"/);
  assert.match(csv, /"'\+malicious@example\.com"/);
  assert.ok(csv.endsWith('\r\n'));
});

test('organizer mutation metadata is bounded and explicit', () => {
  assert.equal(validateActor('  abc-operations  '), 'abc-operations');
  assert.equal(validateReason('  duplicate-registration  '), 'duplicate-registration');
  assert.equal(validateEventStatus('closed'), 'closed');
  assert.equal(validateEventStatus('open'), 'open');
  assert.equal(validateEventStatus('completed'), 'completed');
  assert.throws(
    () => validateEventStatus('draft'),
    /must be open, closed, completed, or cancelled/
  );
  assert.throws(() => validateActor('x'), /between 2 and 120/);
  assert.throws(() => validateReason('Taylor asked by email'), /Reason must be one of/);
});

test('CLI parsing rejects unknown and duplicate options', () => {
  assert.deepEqual(
    parseArgs(['--event', 'community-walk'], { allowed: ['event'] }),
    { event: 'community-walk' }
  );
  assert.throws(
    () => parseArgs(['--dry-run', 'true'], { allowed: ['event'] }),
    /Unknown argument: --dry-run/
  );
  assert.throws(
    () => parseArgs(['--event', 'one', '--event', 'two'], { allowed: ['event'] }),
    /Duplicate argument/
  );
});

test('forced CSV replacement is audited before publish and always becomes owner-only', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-csv-export-'));
  const outputPath = path.join(directory, 'registrations.csv');
  fs.writeFileSync(outputPath, 'old export', { mode: 0o644 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let auditCalls = 0;
  writeAuditedRegistrationCsv({
    outputPath,
    rows: [],
    force: true,
    recordAudit: () => {
      auditCalls += 1;
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'old export');
    },
  });

  assert.equal(auditCalls, 1);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /^"confirmationCode"/);
});

test('an audit failure leaves an existing export untouched and removes staged data', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-csv-audit-'));
  const outputPath = path.join(directory, 'registrations.csv');
  fs.writeFileSync(outputPath, 'keep me', { mode: 0o600 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.throws(
    () => writeAuditedRegistrationCsv({
      outputPath,
      rows: [],
      force: true,
      recordAudit: () => {
        throw new Error('audit unavailable');
      },
    }),
    /audit unavailable/
  );

  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'keep me');
  assert.deepEqual(fs.readdirSync(directory), ['registrations.csv']);
});
