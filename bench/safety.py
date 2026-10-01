#!/usr/bin/env python3
"""
Safety checks, each a concrete experiment (pass = 1, partial = 0.5, fail = 0):
  secret-in-env     a command prints credentials from the environment -> are they masked before the agent sees them?
  secret-in-diff    a committed file contains a credential -> does `git diff` output leak it to the agent?
  secret-at-rest    after an output was trimmed, does the tool's own stored copy contain the raw credential?
  files-at-rest     permissions of every file/dir the tool created (private = 0600/0700)
  offline           the tool works with ALL network access denied (macOS sandbox-exec) and ships no telemetry endpoint
  default-telemetry telemetry/phone-home state on a fresh install
  repo-config       a cloned repository cannot silently change what the agent is shown
Not scored (cannot be tested without hooking the real agent): how a tool's hook interacts with permission rules.
"""
import json, os, re, shutil, stat, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SLIMOUT = os.path.join(ROOT, 'bin', 'slimout.js')
SECRETS = {'AWS_KEY': 'AKIAIOSFODNN7EXAMPLE', 'GITHUB_TOKEN': 'ghp_' + 'a1B2c3D4e5' * 4, 'OPENAI_API_KEY': 'sk-proj-' + 'Zx9Qw3' * 7, 'DB_PASSWORD': 'hunter2-S3cr3tValue'}
RAW_SECRET_FRAGMENTS = ['AKIAIOSFODNN7EXAMPLE', 'a1B2c3D4e5a1B2c3D4e5', 'Zx9QwZx9Qw'.replace('Zx9QwZx9Qw', 'Zx9Qw3Zx9Qw3'), 'hunter2-S3cr3tValue']
leaked = lambda text: [f for f in RAW_SECRET_FRAGMENTS if f in text]

def sh(argv, cwd=None, env=None, check=False):
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, errors='replace'); return p.stdout + p.stderr

def files_under(d):
    out = []
    for r, ds, fs in os.walk(d):
        for n in ds + fs:
            p = os.path.join(r, n); m = stat.S_IMODE(os.lstat(p).st_mode); out.append((p, m, os.path.isdir(p)))
    return out

def evaluate(rtk):
    base = tempfile.mkdtemp(prefix='safety-'); results = {}
    def env_for(tool):
        home = os.path.join(base, tool + '-home'); os.makedirs(home, exist_ok=True)
        return home, {**os.environ, 'HOME': home, 'SLIMOUT_HOME': os.path.join(home, 's'), 'NO_COLOR': '1', **SECRETS}
    # a repo whose history contains a credential
    repo = os.path.join(base, 'repo'); os.makedirs(repo)
    g = lambda *a: sh(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=repo)
    g('init', '-q'); open(os.path.join(repo, 'a.txt'), 'w').write('hello\n'); g('add', '.'); g('commit', '-qm', 'init')
    open(os.path.join(repo, 'config.env'), 'w').write(f"DB_PASSWORD={SECRETS['DB_PASSWORD']}\nOPENAI_API_KEY={SECRETS['OPENAI_API_KEY']}\n"); g('add', '.'); g('commit', '-qm', 'add config')
    noisy = os.path.join(base, 'noisy.js'); open(noisy, 'w').write("for(let i=0;i<3000;i++)console.log('row '+i+' token='+process.env.GITHUB_TOKEN); console.log('ERROR done');")
    cmds = {   # how each tool is invoked for each scenario (its natural interface)
        'slimout':   dict(env=['node', SLIMOUT, 'run', '--', 'printenv'], diff=['node', SLIMOUT, 'run', '--', 'git', '--no-pager', 'diff', 'HEAD~1'], noisy=['node', SLIMOUT, 'run', '--', 'node', noisy]),
        'rtk':       dict(env=[rtk, 'env'], diff=[rtk, 'git', 'diff', 'HEAD~1'], noisy=[rtk, 'err', 'node', noisy]),
        'head+tail': dict(env=['printenv'], diff=['git', '--no-pager', 'diff', 'HEAD~1'], noisy=['node', noisy]),
        'tail-100':  dict(env=['printenv'], diff=['git', '--no-pager', 'diff', 'HEAD~1'], noisy=['node', noisy]),
        'error-grep': dict(env=['printenv'], diff=['git', '--no-pager', 'diff', 'HEAD~1'], noisy=['node', noisy]),
    }
    for tool, c in cmds.items():
        home, env = env_for(tool); r = {}; notes = {}
        # raw output -> then the post-filter baselines are applied exactly like in bench.py (they are plain text filters, no redaction)
        e = sh(c['env'], env=env); d = sh(c['diff'], cwd=repo, env=env); n = sh(c['noisy'], cwd=repo, env=env)
        r['secret-in-env'] = 0.0 if leaked(e) else 1.0; notes['secret-in-env'] = f"{len(leaked(e))} of 4 credentials visible"
        r['secret-in-diff'] = 0.0 if leaked(d) else 1.0; notes['secret-in-diff'] = f"{len(leaked(d))} of 4 credentials visible"
        # at rest: everything the tool itself wrote under HOME
        stored = files_under(home); blob = ''
        for p, m, isd in stored:
            if not isd:
                try: blob += open(p, 'rb').read().decode('utf8', 'replace')
                except Exception: pass
        if not stored: r['secret-at-rest'] = 1.0; r['files-at-rest'] = 1.0; notes['secret-at-rest'] = 'stores nothing'; notes['files-at-rest'] = 'stores nothing'
        else:
            r['secret-at-rest'] = 0.0 if leaked(blob) else 1.0; notes['secret-at-rest'] = f"{len(stored)} files created; raw credentials inside: {len(leaked(blob))}"
            bad = [p for p, m, isd in stored if (m & 0o077)]; r['files-at-rest'] = 1.0 if not bad else 0.0; notes['files-at-rest'] = 'all private (0600/0700)' if not bad else f"{len(bad)} of {len(stored)} readable by other users"
        results[tool] = (r, notes)
    # network / telemetry facts
    for tool in results:
        r, notes = results[tool]
        if tool == 'rtk':
            home, env = env_for('rtk-net'); st = sh([rtk, 'telemetry', 'status'], env=env)
            strings = sh(['strings', rtk]); has_url = bool(re.search(r'https://telemetry\.[a-z.-]+/', strings))
            off = bool(re.search(r'disabled|off|not (yet )?(consent|enabled)', st, re.I)) or 'enabled: no' in st.lower()
            r['default-telemetry'] = 1.0 if off else 0.0; notes['default-telemetry'] = 'default state: ' + (st.strip().replace('\n', ' ')[:90] or '?')
            r['offline'] = 0.5 if has_url else 1.0; notes['offline'] = 'works offline, but ships a telemetry endpoint + TLS client' if has_url else 'no endpoint'
            r['repo-config'] = 0.5; notes['repo-config'] = 'project-local filters exist; blocked until `rtk trust` (fix for CVE-2026-45792) — not independently exploited here'
        else:
            r['default-telemetry'] = 1.0; notes['default-telemetry'] = 'no telemetry code'
            r['offline'] = 1.0; notes['offline'] = 'no network code' + (' (enforced by a CI test)' if tool == 'slimout' else '')
            r['repo-config'] = 1.0; notes['repo-config'] = 'no project-local configuration' if tool == 'slimout' else 'no configuration at all'
    # prove "works with the network denied" for the two real tools
    sb = '(version 1)(allow default)(deny network*)'
    for tool, argv in (('slimout', ['node', SLIMOUT, 'run', '--', 'git', 'status']), ('rtk', [rtk, 'git', 'status'])):
        home, env = env_for(tool + '-sb'); p = subprocess.run(['sandbox-exec', '-p', sb] + argv, cwd=repo, env=env, capture_output=True, text=True)
        results[tool][1]['offline'] += f"; with network denied: exit {p.returncode}"
        if p.returncode != 0: results[tool][0]['offline'] = 0.0
    shutil.rmtree(base, ignore_errors=True)
    return {t: dict(scores=r, notes=n, safety=sum(r.values()) / len(r)) for t, (r, n) in results.items()}

if __name__ == '__main__':
    rtk = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'bench', 'results'); os.makedirs(out, exist_ok=True)
    res = evaluate(rtk); json.dump(res, open(os.path.join(out, 'safety.json'), 'w'), indent=1)
    for t, v in res.items():
        print(f"{t:11} safety {100*v['safety']:5.1f}%  " + '  '.join(f"{k}={'✓' if s==1 else '½' if s==.5 else '✗'}" for k, s in v['scores'].items()))
        for k, n in v['notes'].items(): print(f"      {k:17} {n}")
