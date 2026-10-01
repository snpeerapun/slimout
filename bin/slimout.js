#!/usr/bin/env node
'use strict';
const { run } = require('../lib/run'); const hook = require('../lib/hook'); const inst = require('../lib/install'); const store = require('../lib/store');

const HELP = `slimout — trim command output for AI coding agents (no network, no telemetry, no dependencies)

  slimout install [--project] [--dry-run]   add the Claude Code PreToolUse hook (backs up settings.json first)
  slimout uninstall [--project] [--dry-run] remove it
  slimout status                            where the hook is installed
  slimout run -- <command> [args…]          run a command, slim + redact its output, keep its exit code
  slimout show <id>                         print the full (redacted) output saved when something was omitted (kept 1 hour)
  slimout gain                              local counters: how much output was trimmed
  slimout hook                              (internal) the hook entry point

Env: SLIMOUT_MAX_LINES, SLIMOUT_MAX_BYTES, SLIMOUT_NO_TEE=1, SLIMOUT_REDACT=0, SLIMOUT_HOME (state dir)`;

async function main(argv) {
  const [cmd, ...rest] = argv; const flag = f => rest.includes(f);
  switch (cmd) {
    case 'hook': return hook.main();
    case 'run': { const i = rest.indexOf('--'); const a = i >= 0 ? rest.slice(i + 1) : rest; if (!a.length) { console.error('usage: slimout run -- <command>'); return process.exit(2); } return process.exit(await run(a)); }
    case 'install': case 'uninstall': { const r = inst[cmd]({ project: flag('--project'), dryRun: flag('--dry-run') }); console.log(`${r.file}: ${r.message}`); return; }
    case 'status': for (const s of inst.status()) console.log(`${s.scope.padEnd(8)} ${s.installed ? 'installed' : 'not installed'}  ${s.file}`); return;
    case 'show': try { process.stdout.write(store.readTee(rest[0])); } catch (e) { console.error('slimout: not found (expired after 1 hour, or bad id)'); process.exit(1); } return;
    case 'gain': { const s = store.readStats(); const saved = s.bytesIn - s.bytesOut; console.log(`runs ${s.runs} · in ${s.bytesIn} B · out ${s.bytesOut} B · saved ≈ ${saved} B (~${Math.round(saved / 4)} tokens, ${s.bytesIn ? Math.round(100 * saved / s.bytesIn) : 0}%)`);
      for (const [k, v] of Object.entries(s.byCommand).sort((a, b) => (b[1].bytesIn - b[1].bytesOut) - (a[1].bytesIn - a[1].bytesOut)).slice(0, 8)) console.log(`  ${k.padEnd(10)} runs ${String(v.runs).padEnd(5)} saved ≈ ${v.bytesIn - v.bytesOut} B`); return; }
    default: console.log(HELP);
  }
}
main(process.argv.slice(2)).catch(e => { console.error('slimout:', e.message); process.exit(1); });
