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

**History (kept for honesty).**
- v0.1.0: no command awareness. v0.2.0: git/ls/find/grep reducers. v0.3.0: `git diff`/`show` keeps every file (grouped by directory when huge) and drops code lines first.
- Measuring flaws found and fixed for **all** tools, then everything re-run (v0.1, v0.2 and v0.3 included): `git log` needles had counted commit bodies; error needles included the `path:line:` prefix; `git diff` needles used full paths although tools regroup by directory (now basenames).
- v0.2 was tuned on the 12 "dev" workloads **after seeing v0.1's results**. "Holdout 1" (8 workloads: another repo, tree and arguments) was defined afterwards and not used for tuning. "Holdout 2" (8 more) was used to discover the diff-needle flaw and its aggregates were seen before v0.3's diff change, so treat it as partially contaminated.

| 28 workloads, same measuring | dev (12) saved / kept | holdout 1 (8) | holdout 2 (8) | all 28 |
|---|---|---|---|---|
| slimout v0.1 | 60 % / 86 % | 54 % / 85 % | 44 % / 69 % | 54 % / 81 % |
| slimout v0.2 | 71 % / 84 % | 68 % / 74 % | 52 % / 74 % | 65 % / 79 % |
| **slimout v0.3** | 71 % / 89 % | 68 % / 78 % | 52 % / 86 % | **65 % / 85 %** |
| RTK 0.50.0 | 75 % / 72 % | 55 % / 79 % | 51 % / 90 % | 62 % / 79 % |
| head+tail / tail-100 / error-grep | — | — | — | 49/75 · 52/48 · 66/71 |

Reading it: compaction is a trade-off, not a free win (v0.2 lost information on unseen workloads; v0.3 recovered part of it). On the unseen groups RTK keeps slightly more information on holdout 2 (90 vs 86 %) and saves more on the dev set (75 vs 71 %).
slimout adds ~120 ms per command in this run (Node start-up on a loaded machine; ~55 ms when idle) vs ~30 ms for RTK.
Composite ranking (all 28): slimout 78.4 > error-grep 72.0 > head+tail 67.9 > RTK 67.1 > tail-100 59.4 — #1 vs #2 depends on the weights; the most robust result is safety (7/7 vs RTK 3/7 experiments).
`SLIMOUT_COMPACT=0` restores v0.1's behaviour.
