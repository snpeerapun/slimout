'use strict';
// Guarantees from SECURITY.md, enforced as tests: if someone adds networking, a shell, dynamic code or a dependency, CI fails.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const src = [...fs.readdirSync(path.join(root, 'lib')).map(f => path.join(root, 'lib', f)), path.join(root, 'bin', 'slimout.js')].map(f => [f, fs.readFileSync(f, 'utf8')]);

test('no network access of any kind', () => {
  for (const [f, s] of src) {
    assert.ok(!/require\(['"](?:node:)?(?:https?|net|tls|dgram|dns|http2|worker_threads|cluster)['"]\)/.test(s), f + ' requires a network module');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|\bhttps?:\/\/(?!github\.com\/snpeerapun)/.test(s.replace(/\/\/.*$/gm, '')), f + ' mentions a URL or network API');
  }
});
test('no shell, no dynamic code', () => {
  for (const [f, s] of src) {
    const code = s.replace(/\/\/.*$/gm, '');
    const imp = /\{([^}]*)\}\s*=\s*require\(['"](?:node:)?child_process['"]\)/.exec(code);
    assert.ok(!imp || imp[1].split(',').every(n => ['spawn', 'execFileSync'].includes(n.trim())), f + ' imports a shell-capable child_process API');
    assert.ok(!/child_process['"]\)\.(exec|execSync)\b|shell\s*:\s*true/.test(code), f + ' uses a shell');
    assert.ok(!/\beval\s*\(|new Function\s*\(|vm\.run/.test(code), f + ' uses dynamic code');
  }
});
test('zero dependencies', () => { const p = require('../package.json'); assert.deepStrictEqual(p.dependencies || {}, {}); assert.deepStrictEqual(p.devDependencies || {}, {}); assert.ok(!p.scripts.postinstall && !p.scripts.preinstall && !p.scripts.install); });
test('no project-local configuration is ever read (only env vars and the user-level state dir)', () => {
  for (const [f, s] of src) assert.ok(!/\.slimout|slimout\.(json|toml|ya?ml)|process\.cwd\(\)\s*,\s*['"]\./.test(s.replace(/\/\/.*$/gm, '').replace(/slimout\.js/g, '')) || f.endsWith('install.js') || f.endsWith('perms.js'), f);
});
