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

**What the first run showed (v0.1.0).** slimout keeps more information than RTK and is the only one that passes every safety experiment, but it is conservative: it leaves outputs under ~120 lines untouched and has no git-aware format, so on `git log`/`git diff` it cuts 91–95 % while keeping only 48 % / 3 % of the needles, where RTK keeps 78 % / 83 %. Those are the next things to fix.
