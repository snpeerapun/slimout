'use strict';
// Per-day counters → day / week / month tables. Counters only (runs, bytes in/out); never commands or content.
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;       // local date
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
function weekStart(k) { const d = parse(k); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return dayKey(d); }   // Monday
const labelOf = { day: k => k, week: k => weekStart(k), month: k => k.slice(0, 7) };

function bucket(daily, period) {
  const out = {};
  for (const [k, v] of Object.entries(daily || {})) { const l = labelOf[period](k); const b = (out[l] = out[l] || { runs: 0, bytesIn: 0, bytesOut: 0 }); b.runs += v.runs; b.bytesIn += v.bytesIn; b.bytesOut += v.bytesOut; }
  return out;
}
const pct = b => (b.bytesIn ? Math.round(100 * (b.bytesIn - b.bytesOut) / b.bytesIn) : 0);
const tok = b => Math.max(0, Math.round((b.bytesIn - b.bytesOut) / 4));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

/** rows newest first, at most n */
function table(daily, period, n = 14) {
  const b = bucket(daily, period); const keys = Object.keys(b).sort().reverse().slice(0, n);
  return keys.map(k => ({ label: k, ...b[k], percent: pct(b[k]), tokensSaved: tok(b[k]) }));
}
function render(rows, period) {
  if (!rows.length) return 'no per-day data yet — it is collected from slimout 0.3.1 on, every time a command is trimmed.';
  const head = { day: 'day', week: 'week of (Mon)', month: 'month' }[period];
  const lines = [`${head.padEnd(14)} ${'runs'.padStart(5)} ${'in'.padStart(8)} ${'out'.padStart(8)} ${'saved'.padStart(6)} ${'~tokens'.padStart(9)}`];
  for (const r of rows) lines.push(`${r.label.padEnd(14)} ${String(r.runs).padStart(5)} ${(fmt(r.bytesIn) + 'B').padStart(8)} ${(fmt(r.bytesOut) + 'B').padStart(8)} ${(r.percent + '%').padStart(6)} ${fmt(r.tokensSaved).padStart(9)}  ${'█'.repeat(Math.round(r.percent / 5))}`);
  return lines.join('\n');
}
/** today / last 7 days / last 30 days, from the daily counters */
function windows(daily, now = new Date()) {
  const sum = days => { const t = { runs: 0, bytesIn: 0, bytesOut: 0 }; for (let i = 0; i < days; i++) { const d = new Date(now); d.setDate(d.getDate() - i); const v = (daily || {})[dayKey(d)]; if (v) { t.runs += v.runs; t.bytesIn += v.bytesIn; t.bytesOut += v.bytesOut; } } return { ...t, percent: pct(t), tokensSaved: tok(t) }; };
  return { today: sum(1), last7: sum(7), last30: sum(30) };
}
module.exports = { dayKey, weekStart, bucket, table, render, windows, pct, tok };
