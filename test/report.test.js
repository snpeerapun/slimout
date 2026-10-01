'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const rep = require('../lib/report');
const D = { '2026-09-28': { runs: 2, bytesIn: 1000, bytesOut: 200 }, '2026-09-30': { runs: 1, bytesIn: 3000, bytesOut: 1000 }, '2026-10-01': { runs: 4, bytesIn: 4000, bytesOut: 1000 }, '2026-08-15': { runs: 1, bytesIn: 800, bytesOut: 400 } };

test('weeks start on Monday, months group by YYYY-MM', () => {
  assert.strictEqual(rep.weekStart('2026-09-30'), '2026-09-28'); assert.strictEqual(rep.weekStart('2026-10-04'), '2026-09-28'); assert.strictEqual(rep.weekStart('2026-10-05'), '2026-10-05');
  const w = rep.table(D, 'week'); assert.deepStrictEqual(w.map(r => r.label), ['2026-09-28', '2026-08-10']); assert.strictEqual(w[0].runs, 7);
  const m = rep.table(D, 'month'); assert.deepStrictEqual(m.map(r => r.label), ['2026-10', '2026-09', '2026-08']); assert.strictEqual(m[1].runs, 3);
});
test('percent and token estimates', () => { const d = rep.table(D, 'day')[0]; assert.strictEqual(d.label, '2026-10-01'); assert.strictEqual(d.percent, 75); assert.strictEqual(d.tokensSaved, 750); });
test('windows: today / 7 days / 30 days relative to a date', () => {
  const w = rep.windows(D, new Date(2026, 9, 1)); assert.strictEqual(w.today.runs, 4); assert.strictEqual(w.last7.runs, 7); assert.strictEqual(w.last30.runs, 7); assert.strictEqual(w.last7.percent, Math.round(100 * (8000 - 2200) / 8000));
});
test('empty data renders a clear message', () => assert.match(rep.render([], 'day'), /no per-day data yet/));
test('real runs fill today\'s bucket; gain day/week/month print it; no command text is stored', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'slimout-g-')); const BIN = path.join(__dirname, '..', 'bin', 'slimout.js'); const env = { ...process.env, SLIMOUT_HOME: h };
  spawnSync('node', [BIN, 'run', '--', 'node', '-e', 'for(let i=0;i<2000;i++)console.log("line "+i)'], { env });
  const s = JSON.parse(fs.readFileSync(path.join(h, 'slimout', 'stats.json'), 'utf8')); const k = rep.dayKey(); assert.strictEqual(s.daily[k].runs, 1); assert.ok(s.daily[k].bytesIn > s.daily[k].bytesOut);
  assert.ok(!JSON.stringify(s).includes('line 1999') && !JSON.stringify(s).includes('console.log'));
  for (const p of ['day', 'week', 'month']) { const o = spawnSync('node', [BIN, 'gain', p], { env, encoding: 'utf8' }).stdout; assert.ok(o.includes(p === 'month' ? k.slice(0, 7) : p === 'week' ? rep.weekStart(k) : k), p); assert.match(o, /\d+%/); }
  assert.match(spawnSync('node', [BIN, 'gain'], { env, encoding: 'utf8' }).stdout, /today\s+runs 1/);
});
