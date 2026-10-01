'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { spawnSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const BIN = path.join(__dirname, '..', 'bin', 'slimout.js');
const sh = (args, home, extra = {}) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SLIMOUT_HOME: home, ...extra } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'slimout-r-'));

test('exit code and stdout/stderr are preserved', () => {
  const h = tmp(); const r = sh(['run', '--', 'node', '-e', 'console.log("hi"); console.error("oops"); process.exit(3)'], h);
  assert.strictEqual(r.status, 3); assert.strictEqual(r.stdout, 'hi\n'); assert.strictEqual(r.stderr, 'oops\n');
});
test('secrets in output are masked', () => {
  const r = sh(['run', '--', 'node', '-e', 'console.log("OPENAI_API_KEY=sk-live-abcdefghijklmnop1234567890")'], tmp());
  assert.ok(!r.stdout.includes('abcdefghijklmnop')); assert.match(r.stdout, /\[REDACTED/);
});
test('huge output is trimmed, recovery file is private (0600), redacted, and shows back; counters hold no command text', () => {
  const h = tmp();
  const prog = 'for(let i=0;i<5000;i++)console.log("row "+i+" token=abcdef123456"); console.log("ERROR boom")';
  const r = sh(['run', '--', 'node', '-e', prog], h);
  assert.ok(r.stdout.length < 9000 && r.stdout.includes('ERROR boom')); const id = /slimout show ([0-9a-f]{10})/.exec(r.stdout)[1];
  const f = path.join(h, 'slimout', 'tee', id + '.log'); assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600); assert.strictEqual(fs.statSync(path.join(h, 'slimout')).mode & 0o777, 0o700);
  const full = sh(['show', id], h); assert.ok(full.stdout.includes('row 4999') && !full.stdout.includes('abcdef123456'));
  const stats = fs.readFileSync(path.join(h, 'slimout', 'stats.json'), 'utf8'); assert.ok(!stats.includes('row ') && !stats.includes('boom') && !stats.includes('-e'));
});
test('SLIMOUT_NO_TEE=1 stores nothing', () => {
  const h = tmp(); const r = sh(['run', '--', 'node', '-e', 'for(let i=0;i<3000;i++)console.log("x"+i)'], h, { SLIMOUT_NO_TEE: '1' });
  assert.ok(!/slimout show/.test(r.stdout)); assert.ok(!fs.existsSync(path.join(h, 'slimout', 'tee')));
});
test('show rejects path-traversal ids', () => { const r = sh(['show', '../../etc/passwd'], tmp()); assert.strictEqual(r.status, 1); });
test('unknown command → 127 and a clear message', () => { const r = sh(['run', '--', 'definitely-not-a-binary-xyz'], tmp()); assert.strictEqual(r.status, 127); assert.match(r.stderr, /cannot run/); });
