'use strict';
// Decide whether a Bash command line is a SIMPLE command we can run without a shell and get identical behaviour.
// Anything involving expansion, pipes, redirects, env prefixes, subshells, globs … is refused (returns null) — we never guess.

const ALLOW = [
  ['git', ['status', 'diff', 'log', 'show', 'branch', 'stash', 'blame', 'ls-files', 'shortlog']],
  ['ls', null], ['find', null], ['tree', null], ['rg', null], ['grep', null],
  ['npm', ['install', 'i', 'ci', 'test', 'run', 'ls', 'outdated', 'audit']], ['pnpm', ['install', 'i', 'test', 'run', 'ls', 'outdated']], ['yarn', ['install', 'test', 'run', 'add']],
  ['npx', ['tsc', 'jest', 'vitest', 'eslint', 'prettier']], ['tsc', null], ['jest', null], ['vitest', null], ['eslint', null],
  ['pytest', null], ['python', null], ['python3', null], ['pip', ['install', 'list', 'freeze']], ['pip3', ['install', 'list', 'freeze']],
  ['cargo', ['build', 'test', 'check', 'clippy', 'tree']], ['go', ['build', 'test', 'vet']], ['make', null],
  ['docker', ['ps', 'images', 'logs', 'compose']], ['kubectl', ['get', 'logs', 'describe']], ['brew', ['install', 'update', 'upgrade', 'list', 'outdated']],
];
// never wrap these even if some rule matched: they read/modify file contents or are interactive — exact output matters
const NEVER = new Set(['cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'vim', 'nano', 'ssh', 'scp', 'rsync', 'sudo', 'rm', 'mv', 'cp', 'curl', 'wget', 'echo', 'printf', 'env', 'export', 'cd', 'sh', 'bash', 'zsh', 'node', 'eval', 'exec']);

/** POSIX-ish tokenizer for the safe subset. Returns string[] or null. */
function tokenize(line) {
  if (typeof line !== 'string' || !line.trim() || line.length > 2000) return null;
  if (/[\n\r\0]/.test(line)) return null;
  const toks = []; let cur = ''; let has = false; let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { if (has) { toks.push(cur); cur = ''; has = false; } i++; continue; }
    if (c === "'") { const j = line.indexOf("'", i + 1); if (j < 0) return null; cur += line.slice(i + 1, j); has = true; i = j + 1; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < line.length && line[j] !== '"') { if (line[j] === '\\' || line[j] === '$' || line[j] === '`') return null; s += line[j++]; }
      if (j >= line.length) return null; cur += s; has = true; i = j + 1; continue;
    }
    if ('|&;<>()`$\\*?[]{}!#~'.includes(c)) { if (c === '~' && has) { cur += c; i++; continue; } return null; }   // metachar / glob / expansion outside quotes
    cur += c; has = true; i++;
  }
  if (has) toks.push(cur);
  if (!toks.length) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) return null;      // env prefix
  return toks;
}

function eligible(toks) {
  const [c, sub] = [toks[0], toks[1]];
  if (!c || NEVER.has(c) || c.includes('/')) return false;        // explicit paths / unknown binaries: leave alone
  const rule = ALLOW.find(r => r[0] === c);
  if (!rule) return false;
  if (rule[1] === null) return true;
  return !!sub && rule[1].includes(sub);
}

const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
module.exports = { tokenize, eligible, shq };
