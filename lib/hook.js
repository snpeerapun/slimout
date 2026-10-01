'use strict';
// Claude Code PreToolUse hook. Input JSON on stdin, output JSON on stdout. Fail-open: any doubt → print nothing (command untouched).
const path = require('path');
const { tokenize, eligible, shq } = require('./shellsafe'); const perms = require('./perms');

const BIN = path.resolve(__dirname, '..', 'bin', 'slimout.js');

/** @returns {object|null} hook output or null for "do nothing" */
function decideHook(input, opts = {}) {
  try {
    if (!input || input.tool_name !== 'Bash') return null;
    const command = input.tool_input && input.tool_input.command;
    const toks = tokenize(command); if (!toks || !eligible(toks)) return null;
    const mode = input.permission_mode || 'default';
    const rules = opts.rules || perms.loadRules(input.cwd);
    const verdict = perms.decide(command, rules);
    if (verdict === 'blocked') return null;                                  // deny/ask rules apply to the original command, untouched
    if (verdict === 'none' && mode !== 'bypassPermissions') return null;      // only wrap what the user has ALREADY allowed
    const wrapped = `node ${shq(opts.bin || BIN)} run -- ${toks.map(shq).join(' ')}`;
    const out = { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, command: wrapped } };
    if (verdict === 'allow') { out.permissionDecision = 'allow'; out.permissionDecisionReason = 'slimout: command already allowed by your permission rules (output will be slimmed)'; }
    return { hookSpecificOutput: out };
  } catch { return null; }
}
function main() {
  let data = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { data += d; if (data.length > 1e6) process.exit(0); });
  process.stdin.on('end', () => { let inp = null; try { inp = JSON.parse(data); } catch {} const r = decideHook(inp); if (r) process.stdout.write(JSON.stringify(r)); process.exit(0); });
}
module.exports = { decideHook, main, BIN };
