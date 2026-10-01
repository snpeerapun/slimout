'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { tokenize, eligible, shq } = require('../lib/shellsafe');

test('quoted args are kept as one token', () => assert.deepStrictEqual(tokenize(`rg "foo bar" 'a b' src`), ['rg', 'foo bar', 'a b', 'src']));
test('anything shell-y is refused', () => {
  for (const c of ['ls | head', 'ls && pwd', 'ls; pwd', 'ls > out.txt', 'ls $(pwd)', 'ls `pwd`', 'ls *.js', 'ls ~/x', 'FOO=1 ls', 'rg "$HOME"', 'ls "a\\"b"', 'ls\npwd', 'git log --format=%h ( x', 'echo hi'.repeat(500)])
    assert.strictEqual(tokenize(c), null, c);
});
test('eligibility: allowlist only, never content readers / shells / paths', () => {
  const ok = c => { const t = tokenize(c); return !!t && eligible(t); };
  for (const c of ['git status', 'git diff --stat', 'ls -la src', 'npm test', 'npx tsc --noEmit', 'pytest -q', 'cargo build', 'docker ps']) assert.ok(ok(c), c);
  for (const c of ['cat file', 'sed -n 1,5p f', 'ssh host', 'rm -rf x', 'curl http://x', 'bash script.sh', 'node x.js', './run.sh', '/bin/ls', 'git push', 'git commit -m "x"', 'npm publish', 'unknown-tool']) assert.ok(!ok(c), c);
});
test('shq round-trips through a real shell', () => {
  const { execFileSync } = require('child_process');
  for (const s of ["a b", "it's", 'x"y', '$HOME', '`id`', 'a;b']) assert.strictEqual(execFileSync('sh', ['-c', `printf %s ${shq(s)}`]).toString(), s);
});
