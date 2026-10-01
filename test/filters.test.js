'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { slim, normalize } = require('../lib/filters');

test('small output is returned unchanged', () => { const t = 'On branch main\nnothing to commit\n'; const r = slim(['git', 'status'], t); assert.strictEqual(r.text, t); assert.strictEqual(r.changed, false); });
test('strips ANSI and carriage-return progress redraws', () => {
  assert.deepStrictEqual(normalize('\x1b[31mred\x1b[0m\nprogress 10%\rprogress 50%\rprogress 100%\ndone'), ['red', 'progress 100%', 'done']);
});
test('collapses runs of identical lines', () => {
  const out = normalize(['x', 'same', 'same', 'same', 'same', 'y'].join('\n'));
  assert.deepStrictEqual(out, ['x', 'same', '  [previous line repeated ×4]', 'y']);
});
test('large output is elided but error lines survive', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i} ok`); lines[1234] = 'ERROR: database connection refused';
  const r = slim(['some-tool'], lines.join('\n'));
  assert.ok(r.text.includes('ERROR: database connection refused'));
  assert.match(r.text, /lines omitted/); assert.ok(r.text.length < 8000); assert.ok(r.omittedLines > 1500);
});
test('test runners: passing lines dropped, failures and summary kept', () => {
  const pass = Array.from({ length: 400 }, (_, i) => `PASS test/file${i}.test.js`); const out = [...pass, 'FAIL test/bad.test.js', '  expected 1 to equal 2', 'Tests: 1 failed, 400 passed'].join('\n');
  const r = slim(['npx', 'jest'], out);
  assert.ok(r.text.includes('FAIL test/bad.test.js') && r.text.includes('Tests: 1 failed, 400 passed') && !r.text.includes('PASS test/file7.test.js'));
});
test('never drops a warning/error even in install noise', () => {
  const noise = Array.from({ length: 500 }, (_, i) => `Downloading pkg-${i}`); noise.push('npm WARN deprecated left-pad@1.0.0'); noise.push('npm ERR! code E404');
  const r = slim(['npm', 'install'], noise.join('\n'));
  assert.ok(r.text.includes('npm WARN deprecated') && r.text.includes('npm ERR! code E404'));
});
