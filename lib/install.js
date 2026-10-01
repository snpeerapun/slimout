'use strict';
// Adds / removes ONE PreToolUse(Bash) hook entry in a Claude Code settings.json. Nothing else is touched; a backup is made first.
const fs = require('fs'); const path = require('path'); const os = require('os');
const { BIN } = require('./hook');

const MARK = 'slimout.js';
const where = project => project ? path.join(process.cwd(), '.claude', 'settings.json') : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const entryCmd = () => `node "${BIN}" hook`;
const isOurs = h => h && typeof h.command === 'string' && h.command.includes(MARK) && h.command.includes(' hook');

function load(f) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object'); return j; } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`cannot parse ${f}: ${e.message} — fix it first, slimout will not overwrite it`); } }
function save(f, j, backup) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (backup && fs.existsSync(f)) fs.copyFileSync(f, f + '.bak-slimout');
  const tmp = f + '.slimout.tmp'; fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n'); fs.renameSync(tmp, f);
}
function install({ project = false, dryRun = false } = {}) {
  const f = where(project); const j = load(f);
  j.hooks = j.hooks || {}; j.hooks.PreToolUse = j.hooks.PreToolUse || [];
  const has = j.hooks.PreToolUse.some(e => (e.hooks || []).some(isOurs));
  if (has) return { file: f, changed: false, message: 'already installed' };
  j.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: entryCmd() }] });
  if (!dryRun) save(f, j, true);
  return { file: f, changed: true, message: dryRun ? 'dry run: would add the hook' : 'installed (backup: settings.json.bak-slimout)' };
}
function uninstall({ project = false, dryRun = false } = {}) {
  const f = where(project); if (!fs.existsSync(f)) return { file: f, changed: false, message: 'no settings file' };
  const j = load(f); const list = (j.hooks && j.hooks.PreToolUse) || []; let changed = false;
  const next = list.map(e => { const hs = (e.hooks || []).filter(h => !isOurs(h)); if (hs.length !== (e.hooks || []).length) changed = true; return { ...e, hooks: hs }; }).filter(e => (e.hooks || []).length);
  if (!changed) return { file: f, changed: false, message: 'not installed' };
  if (next.length) j.hooks.PreToolUse = next; else delete j.hooks.PreToolUse;
  if (j.hooks && !Object.keys(j.hooks).length) delete j.hooks;
  if (!dryRun) save(f, j, true);
  return { file: f, changed: true, message: dryRun ? 'dry run: would remove the hook' : 'removed' };
}
function status() { return [false, true].map(p => { const f = where(p); let on = false; try { on = (load(f).hooks?.PreToolUse || []).some(e => (e.hooks || []).some(isOurs)); } catch {} return { scope: p ? 'project' : 'user', file: f, installed: on }; }); }
module.exports = { install, uninstall, status };
