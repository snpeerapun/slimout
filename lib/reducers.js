'use strict';
// Command-aware reducers. Each takes the (already normalized) output lines and returns a more compact set of lines, or null to fall back to the
// generic elision. They only run when the output is large, never touch exit codes, and every omission is announced (and recoverable via `slimout show`).

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** git log (default or medium format): one line per commit = short hash + subject (+ author, relative to the full record we keep in the tee). */
function gitLog(lines, max = 120) {
  if (!lines.some(l => /^commit [0-9a-f]{7,40}/.test(l))) return null;
  const out = []; let n = 0, shown = 0, cur = null;
  const flush = () => { if (!cur) return; n++; if (shown < max) { out.push(`${cur.h} ${cur.subject || '(no subject)'}${cur.author ? `  — ${cur.author}` : ''}${cur.date ? `, ${cur.date}` : ''}`); shown++; } cur = null; };
  for (const l of lines) {
    let m;
    if ((m = /^commit ([0-9a-f]{7,40})/.exec(l))) { flush(); cur = { h: m[1].slice(0, 8) }; }
    else if (!cur) continue;
    else if ((m = /^Author:\s*(.*?)\s*(<.*)?$/.exec(l))) cur.author = m[1];
    else if ((m = /^Date:\s*(.*)$/.exec(l))) cur.date = m[1].replace(/^\w{3} /, '').replace(/ [+-]\d{4}$/, '');
    else if (/^    \S/.test(l) && !cur.subject) cur.subject = clip(l.trim(), 110);
  }
  flush();
  if (n > shown) out.push(`  [… ${n - shown} older commits omitted …]`);
  return out;
}

/**
 * git diff / git show. Principle: never drop a file path before dropping lines of code.
 * Parse into per-file records, then render at progressively stricter levels until the result fits the line budget:
 * hunks + changed lines → fewer lines → hunk headers only → one line per file → files grouped by directory.
 */
function gitDiff(lines, budget = 120) {
  if (!lines.some(l => /^diff --git /.test(l))) return null;
  let i = 0; const pre = []; while (i < lines.length && !/^diff --git /.test(lines[i])) pre.push(lines[i++]);
  const files = []; let f = null, h = null;
  for (; i < lines.length; i++) {
    const l = lines[i]; let m;
    if ((m = /^diff --git a\/(.*) b\/(.*)$/.exec(l))) { f = { path: m[2], note: '', add: 0, del: 0, hunks: [] }; files.push(f); h = null; continue; }
    if (!f) continue;
    if (/^new file mode/.test(l)) f.note = ' (new)'; else if (/^deleted file mode/.test(l)) f.note = ' (deleted)'; else if (/^rename to /.test(l)) f.note = ' (renamed)'; else if (/^Binary files/.test(l)) f.note = ' (binary)';
    if (/^(index |--- |\+\+\+ |similarity|rename |old mode|new mode|new file mode|deleted file mode|Binary files)/.test(l)) continue;
    if (/^@@/.test(l)) { h = { head: clip(l, 100), lines: [] }; f.hunks.push(h); continue; }
    if (h && /^[+-]/.test(l)) { if (l[0] === '+') f.add++; else f.del++; h.lines.push(clip(l, 160)); }
  }
  const add = files.reduce((a, x) => a + x.add, 0), del = files.reduce((a, x) => a + x.del, 0);
  const head = pre.length > 24 ? [...pre.slice(0, 24), `  [… ${pre.length - 24} header lines omitted …]`] : pre;
  const tail = `  [diff total: ${files.length} files, +${add} −${del}]`;
  const render = (maxHunks, maxLines, maxFiles = 400) => {
    const out = [...head];
    files.slice(0, maxFiles).forEach(x => {
      out.push(`diff ${x.path}${x.note} (+${x.add} −${x.del})`);
      x.hunks.slice(0, maxHunks).forEach(hk => { out.push(hk.head); hk.lines.slice(0, maxLines).forEach(l => out.push(l)); if (hk.lines.length > maxLines) out.push(`  [… ${hk.lines.length - maxLines} more lines in this hunk …]`); });
      if (x.hunks.length > maxHunks && maxHunks > 0) out.push(`  [… ${x.hunks.length - maxHunks} more hunks in this file …]`);
    });
    if (files.length > maxFiles) out.push(`  [… ${files.length - maxFiles} more files omitted …]`);
    out.push(tail); return out;
  };
  for (const [mh, ml] of [[3, 6], [2, 3], [1, 1], [0, 0]]) { const o = render(mh, ml); if (o.length <= budget) return o; }
  // still too long: group file paths by directory (every path survives; counts replace per-file lines)
  const by = new Map(); for (const x of files) { const k = x.path.lastIndexOf('/'); const d = k >= 0 ? x.path.slice(0, k) : '.'; if (!by.has(d)) by.set(d, []); by.get(d).push(x); }
  const out = [...head]; let used = 0;
  for (const [d, xs] of by) { if (out.length >= budget - 2) break; out.push(`${d}/ (${xs.length} files, +${xs.reduce((a, x) => a + x.add, 0)} −${xs.reduce((a, x) => a + x.del, 0)}): ${xs.slice(0, 12).map(x => x.path.slice(x.path.lastIndexOf('/') + 1) + x.note).join(' ')}${xs.length > 12 ? ` +${xs.length - 12} more` : ''}`); used++; }
  if (used < by.size) out.push(`  [… ${by.size - used} more directories omitted …]`);
  out.push(tail); return out;
}

/** git status: drop the hint prose, keep branch line + every path. */
function gitStatus(lines) {
  if (!lines.some(l => /^(On branch|HEAD detached|## )/.test(l))) return null;
  return lines.filter(l => l.trim() && !/^\s*\(use "git /.test(l) && !/^no changes added to commit/.test(l));   // headings (staged / unstaged / untracked) and paths stay
}

/** `ls -l` style rows: keep type, size and name (drop owner/group/links/date) once the listing is long. */
function lsLong(lines) {
  const rows = lines.map(l => /^([-dlcbps])[rwxsStT-]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]{4,5}\s+(.*)$/.exec(l));
  const ok = rows.filter(Boolean).length; if (ok < lines.length * 0.7) return null;
  return lines.map((l, i) => (rows[i] ? `${rows[i][1] === 'd' ? 'd' : rows[i][1] === 'l' ? 'l' : ' '} ${rows[i][2].padStart(9)} ${rows[i][3]}` : l));
}

/** find / plain path lists: group by directory. */
function pathList(lines, perDir = 20, maxDirs = 60) {
  if (lines.length < 2 || !lines.every(l => /^[.\/~\w-][^\n]*$/.test(l) && !/\s{2,}/.test(l))) return null;
  const by = new Map();
  for (const l of lines) { const k = l.lastIndexOf('/'); const d = k >= 0 ? l.slice(0, k) : '.'; const b = k >= 0 ? l.slice(k + 1) : l; if (!by.has(d)) by.set(d, []); by.get(d).push(b); }
  if (by.size === lines.length) return null;            // nothing shares a directory: grouping would not help
  const out = []; let cut = 0;
  for (const [d, names] of by) { if (out.length >= maxDirs) { cut += names.length; continue; } out.push(`${d}/ (${names.length}): ${names.slice(0, perDir).join(' ')}${names.length > perDir ? ` +${names.length - perDir} more` : ''}`); }
  if (cut) out.push(`  [… ${cut} more files in ${by.size - maxDirs} more directories …]`);
  return out;
}

/** grep -n / grep -rn / rg -n: group matches by file, cap per file. */
function grepGroup(lines, perFile = 4, maxFiles = 50) {
  const re = /^(.+?):(\d+):(.*)$/; if (lines.filter(l => re.test(l)).length < lines.length * 0.8) return null;
  const by = new Map();
  for (const l of lines) { const m = re.exec(l); if (!m) continue; if (!by.has(m[1])) by.set(m[1], []); by.get(m[1]).push(`${m[2]}:${clip(m[3].trim(), 110)}`); }
  const out = []; let cutFiles = 0, cutHits = 0, f = 0;
  for (const [file, hits] of by) {
    if (++f > maxFiles) { cutFiles++; cutHits += hits.length; continue; }
    out.push(`${file} (${hits.length}):`); hits.slice(0, perFile).forEach(h => out.push('  ' + h)); if (hits.length > perFile) out.push(`  [+${hits.length - perFile} more in this file]`);
  }
  if (cutFiles) out.push(`  [… ${cutHits} matches in ${cutFiles} more files omitted …]`);
  return out;
}

/** @returns {string[]|null} */
/** `git -C dir --no-pager -c k=v log …` → 'log' (skip git's global options) */
function gitSub(cmd) {
  for (let i = 1; i < cmd.length; i++) {
    const a = cmd[i];
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') { i++; continue; }
    if (a.startsWith('-')) continue;
    return a;
  }
  return null;
}
function reduce(cmd, lines) {
  const c = cmd[0]; const sub = c === 'git' ? gitSub(cmd) : cmd[1];
  if (c === 'git' && sub === 'log') return gitLog(lines);
  if (c === 'git' && (sub === 'diff' || sub === 'show')) { const d = gitDiff(lines); if (d) return d; return sub === 'show' ? gitLog(lines) : null; }
  if (c === 'git' && sub === 'status') return gitStatus(lines);
  if (c === 'ls') return lsLong(lines);
  if (c === 'find' || c === 'tree' && false) return pathList(lines);
  if (c === 'grep' || c === 'rg') return grepGroup(lines);
  return null;
}
module.exports = { reduce, gitSub, gitLog, gitDiff, gitStatus, lsLong, pathList, grepGroup };
