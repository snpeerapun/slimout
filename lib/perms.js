'use strict';
// Reads the user's OWN Claude Code permission rules so we never widen them: we only rewrite a command that an explicit
// allow rule already covers, and never one that a deny/ask rule matches.
const fs = require('fs'); const path = require('path'); const os = require('os');

function settingsFiles(cwd) {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return [path.join(home, 'settings.json'), path.join(cwd || process.cwd(), '.claude', 'settings.json'), path.join(cwd || process.cwd(), '.claude', 'settings.local.json')];
}
function loadRules(cwd) {
  const r = { allow: [], deny: [], ask: [] };
  for (const f of settingsFiles(cwd)) {
    try { const p = JSON.parse(fs.readFileSync(f, 'utf8')).permissions || {}; for (const k of Object.keys(r)) if (Array.isArray(p[k])) r[k].push(...p[k].filter(x => typeof x === 'string')); } catch { /* missing/invalid → no rules from that file */ }
  }
  return r;
}
/** Does the Bash rule string (e.g. "Bash(git diff:*)", "Bash(npm run *)", "Bash(ls)") cover this exact command? */
function ruleMatches(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule); if (!m) return rule === 'Bash';          // bare "Bash" = every Bash command
  const pat = m[1].trim(); const cmd = command.trim();
  if (pat.endsWith(':*')) { const p = pat.slice(0, -2); return cmd === p || cmd.startsWith(p + ' '); }
  if (pat.includes('*')) return new RegExp('^' + pat.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(cmd);
  return cmd === pat;
}
/** 'allow' | 'blocked' | 'none' */
function decide(command, rules) {
  if (rules.deny.some(r => ruleMatches(r, command)) || rules.ask.some(r => ruleMatches(r, command))) return 'blocked';
  return rules.allow.some(r => ruleMatches(r, command)) ? 'allow' : 'none';
}
module.exports = { loadRules, ruleMatches, decide };
