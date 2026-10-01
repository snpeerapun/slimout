'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slimout-i-')); process.env.CLAUDE_CONFIG_DIR = dir;
const inst = require('../lib/install'); const f = path.join(dir, 'settings.json');

test('install keeps existing settings, makes a backup, is idempotent', () => {
  const before = { permissions: { allow: ['Bash(git status:*)'] }, hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-hook' }] }], Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, model: 'opus' };
  fs.writeFileSync(f, JSON.stringify(before));
  assert.strictEqual(inst.install().changed, true); assert.strictEqual(inst.install().changed, false);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepStrictEqual(j.permissions, before.permissions); assert.strictEqual(j.model, 'opus'); assert.deepStrictEqual(j.hooks.Stop, before.hooks.Stop);
  assert.strictEqual(j.hooks.PreToolUse.length, 2); assert.strictEqual(j.hooks.PreToolUse[0].hooks[0].command, 'my-own-hook');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f + '.bak-slimout', 'utf8')), before);
});
test('uninstall removes only our entry and leaves the rest', () => {
  assert.strictEqual(inst.uninstall().changed, true);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); assert.strictEqual(j.hooks.PreToolUse.length, 1); assert.strictEqual(j.hooks.PreToolUse[0].hooks[0].command, 'my-own-hook'); assert.ok(j.hooks.Stop);
  assert.strictEqual(inst.uninstall().changed, false);
});
test('refuses to overwrite a settings file it cannot parse', () => {
  fs.writeFileSync(f, '{ not json'); assert.throws(() => inst.install(), /will not overwrite/); assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ not json');
});
test('dry run changes nothing', () => { fs.writeFileSync(f, '{}'); inst.install({ dryRun: true }); assert.strictEqual(fs.readFileSync(f, 'utf8'), '{}'); });
