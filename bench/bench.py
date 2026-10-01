#!/usr/bin/env python3
"""
Reproducible benchmark: command-output reducers for AI coding agents.

  python3 bench/bench.py --rtk /path/to/rtk [--repo /path/to/git/repo --tree /path/with/many/files] --out bench/results

What is measured (same commands, same machine, same inputs for every tool):
  tokens   cl100k_base token count of what the agent would receive (stdout+stderr)        -> savings %
  recall   share of "needles" (what an agent must not lose: newest commits, changed file paths, failing tests,
           every error/warning line, first entries of listings) still present in the output     -> information kept %
  ms       median wall time of the wrapped command minus the raw command                        -> overhead
Safety is scored separately by bench/safety.py. Contenders: slimout, RTK, head+tail, tail-100, error-grep. 'raw' is the 0 % baseline.
Disclosure: slimout is written by the author of this benchmark; the workloads and needle rules are fixed in this file — read them.
"""
import argparse, json, os, re, shutil, statistics, subprocess, sys, tempfile, time
import tiktoken

ENC = tiktoken.get_encoding('cl100k_base')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLIMOUT = os.path.join(ROOT, 'bin', 'slimout.js')
IMPORTANT = re.compile(r'\b(error|errors|fail|failed|failure|fatal|panic|exception|traceback|warn|warning|denied|cannot|not found|assert)\b|✗|✘|×', re.I)
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')
toks = lambda s: len(ENC.encode(s, disallowed_special=()))
norm = lambda s: re.sub(r'\s+', ' ', ANSI.sub('', s)).strip()

# ---------- fixtures (deterministic, generated; no private data) ----------
def make_fixture(d):
    os.makedirs(d, exist_ok=True)
    w = lambda n, t: open(os.path.join(d, n), 'w').write(t)
    w('package.json', json.dumps({'name': 'fx', 'version': '1.0.0', 'scripts': {'test': 'node noisy-test.js', 'build': 'node noisy-build.js', 'setup': 'node noisy-install.js'}}))
    w('noisy-test.js', """
for (let i=0;i<900;i++) console.log('PASS test/unit/module'+i+'.test.js ('+(i%9+1)+'.'+(i%7)+'s)');
console.log('FAIL test/api/payments.test.js\\n  ● payments › refunds the full amount\\n    expect(received).toBe(expected)\\n    Expected: 4200\\n    Received: 4199\\n      at Object.<anonymous> (test/api/payments.test.js:88:31)');
console.log('FAIL test/db/migrate.test.js\\n  ● migrate › is idempotent\\n    TypeError: Cannot read properties of undefined (reading \\'rows\\')\\n      at run (src/db/migrate.js:41:19)');
console.log('Tests: 2 failed, 900 passed, 902 total'); process.exit(1);
""")
    w('noisy-build.js', """
for (let i=0;i<700;i++) console.log('[build] compiling src/components/Widget'+i+'.tsx ... done');
console.log('src/app.tsx(14,9): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.');
console.log('src/lib/api.ts(77,3): error TS2345: Argument of type \\'undefined\\' is not assignable to parameter of type \\'Config\\'.');
console.log('src/util/dates.ts(5,1): error TS2304: Cannot find name \\'dayjs\\'.');
for (let i=0;i<5;i++) console.log('warning: unused variable tmp'+i+' in src/legacy/file'+i+'.ts');
console.error('Found 3 errors in 3 files.'); process.exit(2);
""")
    w('noisy-install.js', """
for (let i=0;i<1200;i++) console.log('npm http fetch GET 200 https://registry.npmjs.org/pkg-'+i+' '+(20+i%90)+'ms (cache miss)');
console.log('npm WARN deprecated left-pad@1.3.0: use String.prototype.padStart()');
console.log('npm WARN deprecated request@2.88.2: request has been deprecated');
console.log('npm ERR! code ERESOLVE\\nnpm ERR! ERESOLVE could not resolve peer dependency react@17 from ui-kit@3.2.0'); process.exit(1);
""")
    open(os.path.join(d, 'list.txt'), 'w').write('')
    os.makedirs(os.path.join(d, 'src'), exist_ok=True)
    for i in range(400): open(os.path.join(d, 'src', f'file_{i:03d}.js'), 'w').write('\n'.join(f'function fn_{i}_{k}() {{ return {k}; }}' for k in range(8)))

# ---------- needles: what an agent must not lose (tool-agnostic) ----------
def errors(raw, n=30): return [norm(l)[:60] for l in raw.splitlines() if IMPORTANT.search(l)][:n]
def first(raw, n=15): return [norm(l)[:50] for l in raw.splitlines() if l.strip()][:n]
def n_log(raw): return [norm(m)[:40] for m in re.findall(r'^    (\S.*)$', raw, re.M)][:12]
def n_diff(raw): return [m.split(' b/')[-1] for m in re.findall(r'^diff --git a/(.*)$', raw, re.M)][:25]
def n_status(raw): return [re.sub(r'^\s*(modified:|new file:|deleted:|renamed:|\S+\s)\s*', '', l).strip() for l in raw.splitlines() if re.match(r'^\s*(modified:|new file:|deleted:|renamed:|\?\?|[AMD] )', l)][:15]
def n_paths(raw): return [os.path.basename(norm(l).split(':')[0]) for l in raw.splitlines() if l.strip()][:15]
def n_names(raw): return [norm(l).split()[-1] for l in raw.splitlines() if l.strip() and not l.startswith('total')][:15]
FIXTURE_NEEDLES = {
  'test':  ['payments.test.js', 'Expected: 4200', 'Received: 4199', 'migrate.test.js', "reading 'rows'", '2 failed, 900 passed'],
  'build': ['TS2322', 'TS2345', 'TS2304', 'src/app.tsx(14,9)', 'src/lib/api.ts(77,3)', 'Found 3 errors', 'unused variable tmp0', 'unused variable tmp4'],
  'setup': ['deprecated left-pad', 'deprecated request', 'ERESOLVE could not resolve peer dependency react@17'],
}

def workloads(fx, repo, tree):
    W = []
    sub = lambda k: (lambda raw: FIXTURE_NEEDLES[k])
    W += [dict(id='fixture: npm test (900 pass, 2 fail)', cwd=fx, raw=['npm', 'test'], rtk=['test', 'npm', 'test'], needles=sub('test')),
          dict(id='fixture: build (700 lines, 3 errors)', cwd=fx, raw=['npm', 'run', 'build'], rtk=['err', 'npm', 'run', 'build'], needles=sub('build')),
          dict(id='fixture: npm install noise + ERESOLVE', cwd=fx, raw=['npm', 'run', 'setup'], rtk=['err', 'npm', 'run', 'setup'], needles=sub('setup')),
          dict(id='fixture: ls -la (400 files)', cwd=os.path.join(fx, 'src'), raw=['ls', '-la'], rtk=['ls', '-la'], needles=lambda r: n_names(r)),
          dict(id='fixture: find . -name "*.js"', cwd=fx, raw=['find', '.', '-name', '*.js'], rtk=['find', '.', '-name', '*.js'], needles=lambda r: n_paths(r)),
          dict(id='fixture: grep -rn "function" (3200 hits)', cwd=fx, raw=['grep', '-rn', 'function', 'src'], rtk=['grep', '-rn', 'function', 'src'], needles=lambda r: n_paths(r))]
    if repo:
        W += [dict(id='real repo: git log -n 300', cwd=repo, raw=['git', 'log', '-n', '300'], rtk=['git', 'log', '-n', '300'], needles=n_log),
              dict(id='real repo: git diff HEAD~15', cwd=repo, raw=['git', '--no-pager', 'diff', 'HEAD~15'], rtk=['git', 'diff', 'HEAD~15'], needles=n_diff),
              dict(id='real repo: git status', cwd=repo, raw=['git', 'status'], rtk=['git', 'status'], needles=n_status),
              dict(id='real repo: git show --stat HEAD~3', cwd=repo, raw=['git', '--no-pager', 'show', '--stat', 'HEAD~3'], rtk=['git', 'show', '--stat', 'HEAD~3'], needles=lambda r: n_log(r)[:1] + n_diff_stat(r))]
    if tree:
        W += [dict(id='real tree: ls -laR (2 levels)', cwd=tree, raw=['ls', '-la'], rtk=['ls', '-la'], needles=lambda r: n_names(r)),
              dict(id='real tree: find . -name "*.json"', cwd=tree, raw=['find', '.', '-maxdepth', '4', '-name', '*.json'], rtk=['find', '.', '-maxdepth', '4', '-name', '*.json'], needles=lambda r: n_paths(r))]
    return W
def n_diff_stat(raw): return [norm(l).split('|')[0].strip()[-40:] for l in raw.splitlines() if '|' in l][:15]

# ---------- tools ----------
def t_raw(w, env): return w['raw']
def baseline(post):
    return post
def headtail(text):
    L = text.splitlines()
    return text if len(L) <= 120 else '\n'.join(L[:60] + [f'[… {len(L)-120} lines omitted …]'] + L[-60:]) + '\n'
def tail100(text): L = text.splitlines(); return text if len(L) <= 100 else '\n'.join(L[-100:]) + '\n'
def errgrep(text):
    L = text.splitlines(); keep = set()
    for i, l in enumerate(L):
        if IMPORTANT.search(l): keep.update({max(0, i - 1), i, min(len(L) - 1, i + 1)})
    return '\n'.join(L[i] for i in sorted(keep)) + '\n' if keep else '\n'.join(L[:20]) + '\n'

def run(argv, cwd, env, stdin_text=None):
    t = time.perf_counter()
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, errors='replace')
    return (p.stdout + p.stderr), time.perf_counter() - t, p.returncode

def evaluate(W, rtk_bin, reps=3):
    home = tempfile.mkdtemp(prefix='bench-home-'); env = {**os.environ, 'RTK_TELEMETRY_DISABLED': '1', 'HOME': home, 'SLIMOUT_HOME': os.path.join(home, 's'), 'NO_COLOR': '1', 'CI': '1'}
    tools = ['slimout', 'rtk', 'head+tail', 'tail-100', 'error-grep']
    res = {t: [] for t in tools}; rows = []
    for w in W:
        raw, _, _ = run(w['raw'], w['cwd'], env); raw_t = toks(raw); need = [n for n in w['needles'](raw) if n] + errors(raw, 12)
        need = list(dict.fromkeys(need)) or ['']
        base_ms = statistics.median(run(w['raw'], w['cwd'], env)[1] for _ in range(reps)) * 1000
        outs = {}
        def timed(argv):
            o, _, _ = run(argv, w['cwd'], env); ms = statistics.median(run(argv, w['cwd'], env)[1] for _ in range(reps)) * 1000; return o, ms
        outs['slimout'] = timed(['node', SLIMOUT, 'run', '--'] + w['raw']) if True else None
        outs['rtk'] = timed([rtk_bin] + w['rtk']) if rtk_bin else (raw, base_ms)
        for name, fn in (('head+tail', headtail), ('tail-100', tail100), ('error-grep', errgrep)): outs[name] = (fn(raw), base_ms)
        for t in tools:
            o, ms = outs[t]; ot = toks(o); on = norm(o)
            rec = sum(1 for n in need if norm(n) in on or norm(n).lower() in on.lower()) / len(need)
            res[t].append(dict(wl=w['id'], raw_tokens=raw_t, tool_tokens=ot, savings=max(-1.0, 1 - ot / max(1, raw_t)), recall=rec, overhead_ms=max(0.0, ms - base_ms)))
        rows.append(dict(wl=w['id'], raw_tokens=raw_t, needles=len(need)))
    shutil.rmtree(home, ignore_errors=True)
    return res, rows

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--rtk'); ap.add_argument('--repo'); ap.add_argument('--tree'); ap.add_argument('--out', default=os.path.join(ROOT, 'bench', 'results')); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); fx = tempfile.mkdtemp(prefix='bench-fx-'); make_fixture(fx)
    W = workloads(fx, a.repo, a.tree); res, rows = evaluate(W, a.rtk)
    json.dump(dict(workloads=rows, results=res), open(os.path.join(a.out, 'perf.json'), 'w'), indent=1)
    print(f"{'tool':12} {'savings':>9} {'recall':>8} {'overhead':>10}")
    for t, rs in res.items(): print(f"{t:12} {100*statistics.mean(r['savings'] for r in rs):8.1f}% {100*statistics.mean(r['recall'] for r in rs):7.1f}% {statistics.mean(r['overhead_ms'] for r in rs):8.0f}ms")
    shutil.rmtree(fx, ignore_errors=True)
if __name__ == '__main__': main()
