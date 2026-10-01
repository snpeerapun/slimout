# Security & privacy model

slimout sits between an AI coding agent and your shell, so it is built to be **boring and auditable**: ~360 lines of plain
Node.js, zero dependencies, nothing to trust but this repository. These are guarantees, and each one is enforced by a test
(`test/policy.test.js`, `test/hook.test.js`, `test/run.test.js`) that fails CI if broken.

## What it never does
| Guarantee | How it is enforced |
|---|---|
| **No network access.** No telemetry, no update check, no "cloud". | Test fails if any `lib/` or `bin/` file requires `http/https/net/tls/dgram/dns` or mentions a URL or `fetch`. |
| **No dependencies, no install scripts.** | Test asserts `dependencies`/`devDependencies` are empty and no `pre/post/install` script exists. |
| **No shell.** Wrapped commands are executed with `spawn(argv)`, never through `sh -c`. | Test forbids `exec`, `execSync`, `shell: true`. |
| **No dynamic code.** | Test forbids `eval`, `new Function`, `vm.run*`. |
| **No project-local configuration.** A cloned repo cannot change what the agent sees (the class of bug behind RTK's CVE-2026-45792). | Configuration is environment variables only; there is no `.slimout*` file lookup. |
| **Never widens your permissions.** | See below. |
| **Never stores prompts, commands, arguments or secrets.** | Counters only (`runs`, byte totals, command *name*); recovery files hold *redacted* output only. |

## Permissions: the hook only wraps what you already allowed
The Claude Code `PreToolUse` hook rewrites a Bash command **only if**
1. it is a *simple* command (no pipes, redirects, `&&`, `;`, `$`, backticks, globs, `~`, env-prefixes, subshells) — anything else is left untouched;
2. it is on a small allowlist of read-mostly tools (`git status/diff/log…`, `ls`, `find`, `rg`, test/build/install commands…); `cat`, `sed`, `ssh`, `rm`, `curl`, `bash`, `node`, explicit paths etc. are **never** wrapped;
3. **an explicit `allow` rule of yours already matches the original command** and no `deny`/`ask` rule does (or you run in `bypassPermissions` mode, where no permission decision is made at all).

When it wraps, it reports `permissionDecision: allow` *only* in case 3 because your own rule said so. In every doubtful case it prints nothing and
the command runs exactly as typed, with the normal permission prompt showing the **original** command.
Failure mode is always "do nothing" (fail-open for the command, never for permissions).

## Secrets
Output is passed through `redact()` **before** it is shown to the model or written anywhere: AWS/GitHub/Anthropic/OpenAI/Slack/Google keys, JWTs,
bearer tokens, private-key blocks, `user:password@` URLs, and values of variables whose *name* looks secret (`*_TOKEN=…`, `"api_key": "…"`).
Patterns are conservative on purpose (a false positive hides a value; a false negative leaks one). Disable with `SLIMOUT_REDACT=0` if you must.
Redaction is best-effort, not a guarantee — do not rely on it as your only protection for secrets.

## Local files
Everything lives in one directory (`$SLIMOUT_HOME` or `$XDG_STATE_HOME/slimout`, default `~/.local/state/slimout`), created `0700`; files `0600`.
It refuses a directory that is a symlink or owned by another user. Recovery files (`tee/`) expire after 1 hour and at most 20 are kept;
`SLIMOUT_NO_TEE=1` stores nothing. `slimout show <id>` accepts only a 10-hex-digit id (no path traversal).

## Install / uninstall
`slimout install` edits exactly one thing — a single `PreToolUse` → `Bash` hook entry in `~/.claude/settings.json` (or `.claude/settings.json` with `--project`) —
after writing `settings.json.bak-slimout`. It refuses to touch a file it cannot parse. `slimout uninstall` removes only that entry. `--dry-run` shows what would change.

## Reporting a vulnerability
Open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
