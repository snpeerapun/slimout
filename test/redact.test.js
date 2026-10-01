'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { redact } = require('../lib/redact');

test('masks well-known credential formats', () => {
  const cases = [
    'AKIAIOSFODNN7EXAMPLE', 'ghp_' + 'a'.repeat(36), 'github_pat_' + 'A1b2'.repeat(12), 'sk-ant-' + 'x'.repeat(30), 'sk-' + 'Z9'.repeat(15),
    'xoxb-1234567890-abcdefghij', 'AIza' + 'a'.repeat(35), 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
  ];
  for (const c of cases) assert.match(redact(`before ${c} after`), /\[REDACTED/, c.slice(0, 18));
});
test('masks values of secret-looking names but keeps the name', () => {
  assert.strictEqual(redact('OPENAI_API_KEY=abcd1234efgh'), 'OPENAI_API_KEY=[REDACTED]');
  assert.strictEqual(redact('DB_PASSWORD: "hunter22"'), 'DB_PASSWORD: "[REDACTED]"');
  assert.match(redact('{"access_token": "abcdef123456"}'), /"access_token": "\[REDACTED\]"/);
  assert.match(redact('Authorization: Bearer abcdefghijklmnop1234'), /Bearer \[REDACTED\]/);
});
test('masks passwords inside URLs', () => assert.strictEqual(redact('git clone https://bob:s3cr3t@github.com/x/y'), 'git clone https://bob:[REDACTED]@github.com/x/y'));
test('leaves ordinary text alone', () => {
  const t = 'src/app.js:12: const token = getToken();\nPASS test/a.test.js (1.2s)\nversion 1.2.3 built at 2026-10-01';
  assert.strictEqual(redact(t), t);
});
