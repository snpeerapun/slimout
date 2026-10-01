'use strict';
// Local-only state. Everything lives under one private directory (0700), files 0600, nothing leaves the machine.
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');

const DIR = () => path.join(process.env.SLIMOUT_HOME || process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'slimout');
const TEE_TTL_MS = 60 * 60 * 1000, TEE_MAX = 20;

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(d);
  if (st.isSymbolicLink() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw new Error('refusing unsafe state directory ' + d);
  try { fs.chmodSync(d, 0o700); } catch {}
}
/** Store ALREADY-REDACTED text for later `slimout show`. Returns an id, or null when disabled / on any error. */
function tee(redactedText) {
  if (process.env.SLIMOUT_NO_TEE === '1') return null;
  try {
    const d = path.join(DIR(), 'tee'); ensureDir(path.dirname(d)); ensureDir(d);
    const now = Date.now(); const files = fs.readdirSync(d).filter(f => /^[0-9a-f]{10,}\.log$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.forEach((x, i) => { if (now - x.t > TEE_TTL_MS || i >= TEE_MAX - 1) fs.rmSync(path.join(d, x.f), { force: true }); });
    const id = crypto.randomBytes(5).toString('hex');
    fs.writeFileSync(path.join(d, id + '.log'), redactedText, { mode: 0o600, flag: 'wx' });
    return id;
  } catch { return null; }
}
function readTee(id) {
  if (!/^[0-9a-f]{10}$/.test(id || '')) throw new Error('bad id');
  return fs.readFileSync(path.join(DIR(), 'tee', id + '.log'), 'utf8');
}
/** Counters only — never commands, arguments or output. */
function addStats(cmdName, bytesIn, bytesOut) {
  try {
    const d = DIR(); ensureDir(d); const f = path.join(d, 'stats.json');
    let s = { runs: 0, bytesIn: 0, bytesOut: 0, byCommand: {} }; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    s.runs++; s.bytesIn += bytesIn; s.bytesOut += bytesOut;
    const day = require('./report').dayKey(); s.daily = s.daily || {};
    const dd = (s.daily[day] = s.daily[day] || { runs: 0, bytesIn: 0, bytesOut: 0 }); dd.runs++; dd.bytesIn += bytesIn; dd.bytesOut += bytesOut;
    const keep = Object.keys(s.daily).sort().slice(-400); for (const k of Object.keys(s.daily)) if (!keep.includes(k)) delete s.daily[k];   // ~13 months of days
    const c = (s.byCommand[cmdName] = s.byCommand[cmdName] || { runs: 0, bytesIn: 0, bytesOut: 0 }); c.runs++; c.bytesIn += bytesIn; c.bytesOut += bytesOut;
    fs.writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
  } catch { /* stats are best-effort */ }
}
function readStats() { try { return JSON.parse(fs.readFileSync(path.join(DIR(), 'stats.json'), 'utf8')); } catch { return { runs: 0, bytesIn: 0, bytesOut: 0, byCommand: {} }; } }
module.exports = { tee, readTee, addStats, readStats, DIR };
