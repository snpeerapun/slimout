# Benchmark: command-output reducers for AI coding agents

Compares **slimout**, **RTK 0.50.0**, and three naive baselines (head+tail, `tail -100`, error-grep) on identical commands.
Results (v0.1.0 of slimout, RTK v0.50.0 official release binary, SHA-256 verified): [`results/ranking.png`](results/ranking.png), [`results/per_workload.png`](results/per_workload.png), raw numbers in `results/*.json`.

```bash
python3 -m venv .venv && .venv/bin/pip install tiktoken matplotlib
.venv/bin/python bench/bench.py --rtk /path/to/rtk --repo /path/to/a/git/repo --tree /path/to/a/dir/with/many/files
python3 bench/safety.py /path/to/rtk
.venv/bin/python bench/chart.py
```

**Metrics.** `tokens saved` (cl100k) · `information kept` = share of "needles" still present (newest commits, changed paths, failing tests, every error/warning, first entries of listings) · `overhead` (median extra ms) · `safety` = 7 experiments with fake credentials, a committed secret, a network-denied sandbox, file permissions, default telemetry, repo-local config.
**Composite** = 35 % savings + 35 % info kept + 20 % safety + 10 % speed (a judgement call — all four ingredients are in the chart so you can re-weigh).

**Honest limits.** slimout is written by the author of this benchmark. 12 workloads only (6 generated fixtures, 4 on one real repo, 2 real file trees). Needles favour error-grep (error lines count heavily). Baselines make no safety claim, so they score like raw output on safety. Not tested: how RTK's hook interacts with permission rules; whether `.rtk/filters.toml` can be abused on 0.50.0 (a trust gate exists). Results will move as both tools change — re-run it.

**History (kept for honesty).** v0.1.0 had no command awareness: on a first 12-workload run it saved 60 % and kept 86 % of the needles, but cut `git log`/`git diff` to almost nothing useful and
left short listings untouched, so RTK (git-aware) beat it on savings. v0.2.0 adds git/ls/find/grep reducers. A flaw in the first needle definitions was then found and fixed for *all* tools
(`git log` needles had included commit *bodies*; error needles included the `path:line:` prefix that regrouping tools drop) and everything was re-run, v0.1 included.
v0.2 was tuned on the 12 "dev" workloads **after seeing v0.1's results**; 8 "holdout" workloads (other repos / trees / commands) were defined afterwards and not used for tuning.

| 20 workloads, same measuring | dev (12) saved / kept | holdout (8) saved / kept |
|---|---|---|
| slimout v0.1 | 60 % / 86 % | 54 % / 85 % |
| slimout v0.2 | 71 % / 84 % | 68 % / 74 % |
| RTK 0.50.0 | 75 % / 72 % | 55 % / 79 % |

Reading it: v0.2 saves much more on both groups, but on unseen workloads it keeps less information than v0.1 (85 → 74 %): the compaction is a real trade-off, not a free win. `SLIMOUT_COMPACT=0` restores v0.1's behaviour.
Composite ranking (all 20): slimout 80.8 > error-grep 77.1 > head+tail 70.8 > RTK 67.8 > tail-100 60.0; holdout only: slimout 78.1 > error-grep 71.7 > head+tail 65.3 = RTK 65.3 > tail-100 53.4.
The margin between #1 and #2 is a few points and depends on the weights; the safety gap (100 % vs 43 % for RTK) is the most robust result.
