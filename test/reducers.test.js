'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { gitLog, gitDiff, gitStatus, lsLong, pathList, grepGroup } = require('../lib/reducers'); const { slim } = require('../lib/filters');

const commit = i => [`commit ${String(i).padStart(8, '0')}abcdef0123456789abcdef0123456789`, `Author: Dev ${i % 3} <d${i}@x.io>`, `Date:   Mon Sep 29 10:${String(i % 60).padStart(2, '0')}:00 2026 +0700`, '', `    feat: change number ${i}`, '', `    Longer explanation of change ${i}.`, ''].join('\n');
test('git log: one line per commit, subjects kept, bodies dropped, older commits counted', () => {
  const raw = Array.from({ length: 300 }, (_, i) => commit(i)).join('\n').split('\n');
  const out = gitLog(raw, 120); assert.strictEqual(out.length, 121);
  assert.ok(out[0].includes('feat: change number 0') && out[0].startsWith('00000000')); assert.ok(!out.join('\n').includes('Longer explanation')); assert.match(out[120], /180 older commits omitted/);
});
test('git diff: every file path survives, only the first changed lines per file, totals reported', () => {
  const file = (n) => [`diff --git a/src/f${n}.js b/src/f${n}.js`, 'index 111..222 100644', `--- a/src/f${n}.js`, `+++ b/src/f${n}.js`, '@@ -1,40 +1,40 @@', ...Array.from({ length: 40 }, (_, k) => `+added line ${k} in ${n}`)];
  const raw = Array.from({ length: 30 }, (_, n) => file(n)).flat(); const out = gitDiff(raw);
  for (let n = 0; n < 30; n++) assert.ok(out.some(l => l.startsWith(`diff src/f${n}.js (+40 −0)`)), `file ${n}`);
  assert.ok(out.length <= 120 && out.length < raw.length / 5); assert.ok(out.at(-1).includes('30 files, +1200 −0'));
});
test('git status: hint prose dropped, every path kept', () => {
  const raw = ['On branch main', 'Your branch is up to date with \'origin/main\'.', '', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '\tmodified:   a.js', '\tmodified:   b.js', '', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)', '\tnew.txt', ''];
  const out = gitStatus(raw).join('\n'); assert.ok(out.includes('a.js') && out.includes('b.js') && out.includes('new.txt') && out.includes('On branch main') && !out.includes('(use "git'));
});
test('ls -l: type, size and name kept, owner/date columns dropped', () => {
  const raw = ['total 8', ...Array.from({ length: 60 }, (_, i) => `-rw-r--r--  1 alice  staff  ${1000 + i} Sep 29 10:11 file_${i}.txt`)];
  const out = lsLong(raw); assert.ok(out === null || out.slice(1).every((l, i) => l.includes(`file_${i}.txt`) && !l.includes('alice')));
  const raw2 = Array.from({ length: 60 }, (_, i) => `-rw-r--r--  1 alice  staff  ${1000 + i} Sep 29 10:11 file_${i}.txt`); const o2 = lsLong(raw2); assert.ok(o2[5].includes('file_5.txt') && !o2[5].includes('alice') && o2[5].includes('1005'));
});
test('find: grouped by directory with counts', () => {
  const raw = Array.from({ length: 200 }, (_, i) => `./src/mod${i % 4}/file${i}.js`); const out = pathList(raw);
  assert.strictEqual(out.length, 4); assert.ok(out[0].startsWith('./src/mod0/ (50):') && out[0].includes('+30 more'));
});
test('grep -rn: grouped per file, every file listed', () => {
  const raw = Array.from({ length: 300 }, (_, i) => `src/file${i % 30}.js:${i + 1}:function f${i}() {}`); const out = grepGroup(raw);
  for (let f = 0; f < 30; f++) assert.ok(out.some(l => l.startsWith(`src/file${f}.js (10):`)));
});
test('end to end through slim(): large git log shrinks a lot and keeps newest subjects; small output untouched', () => {
  const raw = Array.from({ length: 200 }, (_, i) => commit(i)).join('\n'); const r = slim(['git', 'log'], raw);
  assert.ok(r.text.length < raw.length / 4 && r.text.includes('feat: change number 0') && r.text.includes('feat: change number 11'));
  const small = 'On branch main\nnothing to commit, working tree clean\n'; assert.strictEqual(slim(['git', 'status'], small).text, small);
});

test('git diff with hundreds of files: every file still appears (grouped by directory) and the budget holds', () => {
  const file = n => [`diff --git a/pkg${n % 25}/sub/f${n}.js b/pkg${n % 25}/sub/f${n}.js`, 'index 1..2 100644', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-old', '+new'];
  const raw = Array.from({ length: 300 }, (_, n) => file(n)).flat(); const out = gitDiff(raw, 120); assert.ok(out.length <= 120);
  const text = out.join('\n'); for (const n of [0, 77, 150, 299]) assert.ok(text.includes(`f${n}.js`), 'f' + n);
});
