const assert = require('node:assert/strict');
const test = require('node:test');

const { parseServerOptions } = require('../src/config');

test('preview server options support separate and inline host and port arguments', () => {
  assert.deepEqual(
    parseServerOptions(['--host', '0.0.0.0', '--port', '4173', '--strictPort']),
    { host: '0.0.0.0', port: 4173 }
  );
  assert.deepEqual(
    parseServerOptions(['--host=127.0.0.1', '--port=3001']),
    { host: '127.0.0.1', port: 3001 }
  );
});

test('preview server options reject unusable values', () => {
  assert.throws(() => parseServerOptions(['--port', '0']), /between 1 and 65535/);
  assert.throws(() => parseServerOptions(['--port', 'abc']), /must be an integer/);
  assert.throws(() => parseServerOptions(['--host', 'bad host']), /host is invalid/);
  assert.throws(() => parseServerOptions(['--host']), /requires a value/);
});
