'use strict';
// `slimout run -- <cmd> <args…>`: run the command WITHOUT a shell, keep its exit code, slim + redact its output.
const { spawn } = require('child_process');
const { slim } = require('./filters'); const { redact } = require('./redact'); const store = require('./store');

const CAP = 16 * 1024 * 1024;     // capture at most 16 MB per stream (the rest is drained and discarded)

function run(argv, io = { out: process.stdout, err: process.stderr }) {
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
    const bufs = { out: [], err: [] }; const size = { out: 0, err: 0 }; let truncated = false;
    const grab = k => d => { if (size[k] < CAP) { bufs[k].push(d); size[k] += d.length; } else truncated = true; };
    child.stdout.on('data', grab('out')); child.stderr.on('data', grab('err'));
    child.on('error', e => { io.err.write(`slimout: cannot run ${argv[0]}: ${e.message}\n`); resolve(127); });
    child.on('close', (code, signal) => {
      const rawOut = Buffer.concat(bufs.out).toString('utf8'), rawErr = Buffer.concat(bufs.err).toString('utf8');
      const doRedact = process.env.SLIMOUT_REDACT !== '0';
      const clean = t => (doRedact ? redact(t) : t);
      const o = slim(argv, clean(rawOut)), e = slim(argv, clean(rawErr));
      const omitted = o.omittedLines + e.omittedLines;
      let note = '';
      if (omitted > 0 || truncated) {
        const full = clean(rawOut) + (rawErr ? '\n--- stderr ---\n' + clean(rawErr) : '');
        const id = store.tee(full);
        note = `[slimout: ${omitted} lines omitted${truncated ? ' (capture capped at 16 MB)' : ''}${id ? `; full redacted output: slimout show ${id}` : ''}]\n`;
      }
      io.out.write(o.text); if (note) io.out.write(note); io.err.write(e.text);
      store.addStats(argv[0], Buffer.byteLength(rawOut) + Buffer.byteLength(rawErr), Buffer.byteLength(o.text) + Buffer.byteLength(note) + Buffer.byteLength(e.text));
      resolve(code === null ? 128 + ({ SIGINT: 2, SIGTERM: 15, SIGKILL: 9 }[signal] || 1) : code);
    });
  });
}
module.exports = { run };
