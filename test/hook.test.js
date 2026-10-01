'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { execSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { decideHook } = require('../lib/hook'); const { ruleMatches, decide } = require('../lib/perms');

const rules = (allow = [], deny = [], ask = []) => ({ allow, deny, ask });
const call = (command, r, mode = 'default', tool = 'Bash') => decideHook({ tool_name: tool, tool_input: { command }, permission_mode: mode, cwd: '/tmp' }, { rules: r, bin: '/opt/slimout/bin/slimout.js' });

test('rule matching: exact, prefix (:*) and wildcard', () => {
  assert.ok(ruleMatches('Bash(git status)', 'git status')); assert.ok(!ruleMatches('Bash(git status)', 'git status -s'));
  assert.ok(ruleMatches('Bash(git diff:*)', 'git diff --stat')); assert.ok(ruleMatches('Bash(git diff:*)', 'git diff')); assert.ok(!ruleMatches('Bash(git diff:*)', 'git difftool'));
  assert.ok(ruleMatches('Bash(npm run *)', 'npm run build')); assert.ok(!ruleMatches('Bash(npm run *)', 'npm install'));
});
test('allowed command is wrapped AND auto-allowed only because the user already allowed it', () => {
  const r = call('git status', rules(['Bash(git status:*)']));
  assert.strictEqual(r.hookSpecificOutput.permissionDecision, 'allow');
  assert.strictEqual(r.hookSpecificOutput.updatedInput.command, `node '/opt/slimout/bin/slimout.js' run -- 'git' 'status'`);
});
test('deny and ask rules win: the command is left untouched', () => {
  assert.strictEqual(call('git diff', rules(['Bash(git:*)'], ['Bash(git diff:*)'])), null);
  assert.strictEqual(call('git diff', rules(['Bash(git:*)'], [], ['Bash(git diff:*)'])), null);
});
test('no matching allow rule in default mode → untouched (normal permission prompt shows the ORIGINAL command)', () => assert.strictEqual(call('git status', rules()), null));
test('bypassPermissions mode: wrapped without making any permission decision', () => {
  const r = call('git status', rules(), 'bypassPermissions'); assert.ok(r); assert.strictEqual(r.hookSpecificOutput.permissionDecision, undefined);
});
test('never touches non-Bash tools, shell-y commands, or garbage input', () => {
  assert.strictEqual(call('git status', rules(['Bash(git:*)']), 'default', 'Read'), null);
  assert.strictEqual(call('git status | cat', rules(['Bash(git:*)'])), null);
  assert.strictEqual(call('cat secrets.txt', rules(['Bash(cat:*)'])), null);
  assert.strictEqual(decideHook(null), null); assert.strictEqual(decideHook({ tool_name: 'Bash' }), null); assert.strictEqual(decideHook({ tool_name: 'Bash', tool_input: { command: 42 } }), null);
});
test('the wrapped command behaves like the original when run by a real shell (output + exit code)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'slimout-t-')); fs.writeFileSync(path.join(d, 'hello world.txt'), 'x');
  const r = decideHook({ tool_name: 'Bash', tool_input: { command: `ls "hello world.txt"` }, permission_mode: 'bypassPermissions', cwd: d }, { rules: rules() });
  const out = execSync(r.hookSpecificOutput.updatedInput.command, { cwd: d, env: { ...process.env, SLIMOUT_HOME: d } }).toString();
  assert.strictEqual(out.trim(), 'hello world.txt');
  const bad = decideHook({ tool_name: 'Bash', tool_input: { command: `ls definitely-missing` }, permission_mode: 'bypassPermissions' }, { rules: rules() });
  let code = 0; try { execSync(bad.hookSpecificOutput.updatedInput.command, { cwd: d, stdio: 'pipe', env: { ...process.env, SLIMOUT_HOME: d } }); } catch (e) { code = e.status; }
  assert.ok(code !== 0, 'exit code of the failing command must propagate');
});
