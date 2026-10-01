'use strict';
// Output reduction. Principles: (1) lossless clean-up first, (2) only then elide, (3) never elide error-looking lines,
// (4) always say what was omitted and how to get it back. Small outputs are returned untouched.

const { reduce, gitSub } = require('./reducers');
const MAX_LINES = Number(process.env.SLIMOUT_MAX_LINES) || 120;
const LIST_LINES = Number(process.env.SLIMOUT_LIST_LINES) || 40;   // listings / git output are compacted much earlier: they are rarely read line by line
const MAX_BYTES = Number(process.env.SLIMOUT_MAX_BYTES) || 8000;
const IMPORTANT = /\b(error|errors|fail|failed|failure|fatal|panic|exception|traceback|warn|warning|denied|cannot|can't|not found|undefined|exit code|assert)\b|✗|✘|×|\bFAIL\b/i;

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

/** Lossless-ish clean-up: ANSI, carriage-return progress redraws, trailing spaces, runs of identical lines. */
function normalize(text) {
  const lines = String(text).replace(ANSI, '').split('\n').map(l => {
    if (l.includes('\r')) { const parts = l.split('\r').filter(Boolean); l = parts.length ? parts[parts.length - 1] : ''; }
    return l.replace(/[ \t]+$/g, '');
  });
  const out = []; let i = 0;
  while (i < lines.length) {
    let j = i; while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++;
    const n = j - i + 1;
    if (n >= 3 && lines[i].trim() !== '') { out.push(lines[i], `  [previous line repeated ×${n}]`); } else for (let k = 0; k < n; k++) out.push(lines[i]);
    i = j + 1;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

const PASS_LINE = /^\s*(✓|✔|PASS\b|PASSED\b|ok\s|\.+$|test .* \.\.\. ok$|\[ *OK *\]|=+ .* passed)/i;
const PROGRESS = /^(npm (http|timing|verb|sill)|Downloading|Resolving|Fetching|Receiving|Unpacking|Progress:|\s*\d+%|Collecting |Using cached|added \d+ packages? in|Compiling |Fresh |Updating )/i;

function kind(cmd) {
  const c = cmd[0] || '', a = cmd.slice(1).join(' ');
  if (/^(pytest|jest|vitest|mocha|go|cargo|npm|pnpm|yarn|python3?|npx)$/.test(c) && /\btest\b|pytest|jest|vitest/.test(c + ' ' + a)) return 'test';
  if (/^(npm|pnpm|yarn|pip3?|brew|cargo|apt|apt-get)$/.test(c) && /\b(install|ci|add|update|upgrade|build|check|clippy)\b/.test(a)) return 'build';
  if (/^(tsc|make|go|cargo|gradle|mvn)$/.test(c) || /^(npx )?tsc/.test(c + ' ' + a)) return 'build';
  if (/^(ls|find|tree|rg|grep|git)$/.test(c)) return 'list';   // (git/ls/find/grep outputs: compacted from LIST_LINES)
  return 'generic';
}

/** Keep important lines (+1 line of context), plus a head and a tail window; mark every gap. */
function elide(lines, head, tail, keepImportant) {
  const keep = new Set();
  for (let i = 0; i < Math.min(head, lines.length); i++) keep.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) keep.add(i);
  if (keepImportant) lines.forEach((l, i) => { if (IMPORTANT.test(l)) { keep.add(i); if (i > 0) keep.add(i - 1); if (i + 1 < lines.length) keep.add(i + 1); } });
  // hard cap so a log full of "error" cannot defeat the purpose: keep the LAST ones when over budget
  let idx = [...keep].sort((a, b) => a - b);
  const cap = MAX_LINES * 2; if (idx.length > cap) idx = idx.slice(0, head).concat(idx.slice(-(cap - head)));
  const out = []; let prev = -1;
  for (const i of idx) { if (i > prev + 1) out.push(`  [… ${i - prev - 1} lines omitted …]`); out.push(lines[i]); prev = i; }
  if (prev < lines.length - 1) out.push(`  [… ${lines.length - 1 - prev} lines omitted …]`);
  return out;
}

/**
 * @returns {{text:string, changed:boolean, omittedLines:number, originalLines:number}}
 */
function slim(cmd, raw) {
  const original = String(raw);
  let lines = normalize(original);
  const bytes = Buffer.byteLength(lines.join('\n'));
  const k0 = kind(cmd), limit = (k0 === 'list' || k0 === 'git') ? LIST_LINES : MAX_LINES;
  if (lines.length <= limit && bytes <= (limit === LIST_LINES ? 2500 : MAX_BYTES)) {           // small → only the lossless clean-up
    const t = lines.join('\n') + (original.endsWith('\n') ? '\n' : '');
    return { text: t, changed: t !== original, omittedLines: 0, originalLines: lines.length };
  }
  const total = lines.length; const k = k0;
  const red = process.env.SLIMOUT_COMPACT === '0' ? null : reduce(cmd, lines);   // command-aware compaction first (SLIMOUT_COMPACT=0 → generic elision only, the v0.1 behaviour)
  if (red) { lines = red.length > MAX_LINES ? elide(red, Math.floor(MAX_LINES * 0.7), 15, false) : red; }   // reducers fit their own budget; this is only a safety net
  else if (k === 'test') {
    const rest = lines.filter(l => !PASS_LINE.test(l));
    lines = rest.length ? rest : lines;
    if (lines.length > MAX_LINES) lines = elide(lines, 10, 40, true);
  } else if (k === 'build') {
    const rest = lines.filter(l => IMPORTANT.test(l) || !PROGRESS.test(l));
    lines = rest.length ? rest : lines;
    if (lines.length > MAX_LINES) lines = elide(lines, 10, 40, true);
  } else if (k === 'list') {
    lines = elide(lines, Math.floor(MAX_LINES * 0.6), Math.floor(MAX_LINES * 0.2), true);
  } else {
    lines = elide(lines, 40, 40, true);
  }
  const omitted = Math.max(0, total - lines.filter(l => !/^\s{2}\[… \d+ lines omitted …\]$/.test(l)).length);
  return { text: lines.join('\n') + '\n', changed: true, omittedLines: omitted, originalLines: total };
}
module.exports = { slim, normalize, kind };
