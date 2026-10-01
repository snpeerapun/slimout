#!/usr/bin/env python3
"""Build the comparison charts from results/perf.json + results/safety.json.  python3 bench/chart.py [results_dir]"""
import json, os, statistics, sys
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
import numpy as np
R = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
perf = json.load(open(os.path.join(R, 'perf.json'))); saf = json.load(open(os.path.join(R, 'safety.json')))
W = dict(savings=0.35, recall=0.35, safety=0.20, speed=0.10)
rows = {}
for t, rs in perf['results'].items():
    s = statistics.mean(max(0, r['savings']) for r in rs); rc = statistics.mean(r['recall'] for r in rs); ov = statistics.mean(r['overhead_ms'] for r in rs)
    sf = saf[t]['safety']; sp = 1 - min(1, ov / 300)
    rows[t] = dict(savings=s, recall=rc, safety=sf, speed=sp, overhead=ov, score=W['savings'] * s + W['recall'] * rc + W['safety'] * sf + W['speed'] * sp)
rank = sorted(rows, key=lambda t: -rows[t]['score'])
json.dump(dict(weights=W, rows=rows, ranking=rank), open(os.path.join(R, 'ranking.json'), 'w'), indent=1)
COL = {'slimout': '#2E7D32', 'rtk': '#1565C0', 'head+tail': '#8D6E63', 'tail-100': '#6D4C41', 'error-grep': '#7B1FA2'}
LAB = {'slimout': 'slimout (ours)', 'rtk': 'RTK 0.50.0', 'head+tail': 'head+tail (60+60)', 'tail-100': 'tail -100', 'error-grep': 'error-grep'}
plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})

fig = plt.figure(figsize=(15, 9)); gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.05], hspace=0.42, wspace=0.28)
ax = fig.add_subplot(gs[0, :])
y = np.arange(len(rank))[::-1]; sc = [rows[t]['score'] * 100 for t in rank]
ax.barh(y, sc, color=[COL[t] for t in rank], height=0.62)
for yi, t, s in zip(y, rank, sc): ax.text(s + 0.8, yi, f"{s:.1f}", va='center', fontweight='bold'); ax.text(1.2, yi, f"#{rank.index(t)+1}", va='center', color='white', fontweight='bold', fontsize=14)
ax.set_yticks(y); ax.set_yticklabels([LAB[t] for t in rank], fontsize=12)
if len(rank) > 1 and abs(rows[rank[0]]['score'] - rows[rank[1]]['score']) < 0.02:
    ax.annotate('#1 and #2 are within 1 point: a tie', xy=(rows[rank[1]]['score'] * 100, y[1]), xytext=(88, (y[0] + y[1]) / 2), fontsize=10, color='#B71C1C', ha='center', va='center', arrowprops=dict(arrowstyle='-', color='#B71C1C')); ax.set_xlim(0, 100); ax.set_xlabel('composite score (0–100)')
ax.set_title(f"Top 1–5: command-output reducers for AI coding agents   (score = {int(W['savings']*100)}% token savings + {int(W['recall']*100)}% information kept + {int(W['safety']*100)}% safety + {int(W['speed']*100)}% speed)", loc='left', fontsize=12.5, fontweight='bold')

ax2 = fig.add_subplot(gs[1, 0]); x = np.arange(len(rank)); w = 0.2
for i, (k, lab) in enumerate((('savings', 'tokens saved'), ('recall', 'info kept'), ('safety', 'safety'), ('speed', 'speed'))):
    vals = [rows[t][k] * 100 for t in rank]; b = ax2.bar(x + (i - 1.5) * w, vals, w, label=lab, color=['#26A69A', '#FFA726', '#5C6BC0', '#BDBDBD'][i])
    for xi, v in zip(x + (i - 1.5) * w, vals): ax2.text(xi, v + 1, f"{v:.0f}", ha='center', fontsize=8)
ax2.set_xticks(x); ax2.set_xticklabels([LAB[t].replace(' (', '\n(') for t in rank], fontsize=9); ax2.set_ylim(0, 112); ax2.set_ylabel('%'); ax2.legend(ncol=4, fontsize=9, loc='upper center', bbox_to_anchor=(0.5, -0.16), frameon=False); ax2.set_title('The four ingredients of the score', loc='left', fontweight='bold')

ax3 = fig.add_subplot(gs[1, 1])
for t in rows:
    ax3.scatter(rows[t]['savings'] * 100, rows[t]['recall'] * 100, s=60 + rows[t]['safety'] * 420, color=COL[t], alpha=0.85, edgecolor='white', linewidth=1.5, zorder=3)
    off = {'slimout': (10, 12), 'head+tail': (-92, -22)}.get(t, (10, 8))
    ax3.annotate(LAB[t].split(' (')[0] + (' (ours)' if t == 'slimout' else ''), (rows[t]['savings'] * 100, rows[t]['recall'] * 100), textcoords='offset points', xytext=off, fontsize=10)
ax3.set_xlabel('tokens saved %  →  (higher = cheaper)'); ax3.set_ylabel('information kept %  →  (higher = safer for the agent)'); ax3.set_xlim(35, 95); ax3.set_ylim(40, 95); ax3.grid(alpha=0.25)
ax3.set_title('Trade-off (bubble size = safety score)', loc='left', fontweight='bold')
fig.text(0.01, -0.03, "Caveats: weights are a judgement call; 'info kept' counts error lines heavily (favours error-grep, which drops everything that is not an error line); slimout v0.2 was tuned on the 12 'dev' workloads after seeing v0.1 results (the 8 holdout workloads were not used for tuning); head+tail/tail/error-grep make no safety claim and score like raw output on safety tests.", fontsize=8.5, color='#B71C1C')
fig.text(0.01, 0.005, "Measured on 28 identical commands (6 generated fixtures + 6 real, used while building; 16 more on other repos/trees defined later), cl100k token counts. slimout is by the author of this benchmark; code + workloads in bench/.", fontsize=8.5, color='#555')
fig.savefig(os.path.join(R, 'ranking.png'), dpi=140, bbox_inches='tight'); plt.close(fig)

# per-workload heatmaps
wl = [r['wl'] for r in perf['workloads']]; tools = rank
fig, axs = plt.subplots(1, 2, figsize=(15, 6.4), gridspec_kw=dict(wspace=0.05))
for a, key, title, cmap in ((axs[0], 'savings', 'Tokens saved per workload (%)', 'YlGn'), (axs[1], 'recall', 'Information kept per workload (%)', 'YlOrBr')):
    M = np.array([[100 * perf['results'][t][i][key] for t in tools] for i in range(len(wl))]); M = np.clip(M, 0, 100)
    im = a.imshow(M, cmap=cmap, vmin=0, vmax=100, aspect='auto')
    for i in range(M.shape[0]):
        for j in range(M.shape[1]): a.text(j, i, f"{M[i, j]:.0f}", ha='center', va='center', fontsize=9, color='black' if 25 < M[i, j] < 85 else ('white' if M[i, j] >= 85 and key == 'savings' else 'black'))
    a.set_xticks(range(len(tools))); a.set_xticklabels([LAB[t].split(' (')[0] for t in tools], rotation=20, ha='right'); a.set_title(title, loc='left', fontweight='bold')
    a.set_yticks(range(len(wl))); a.set_yticklabels(wl if a is axs[0] else [], fontsize=9)
fig.savefig(os.path.join(R, 'per_workload.png'), dpi=140, bbox_inches='tight'); plt.close(fig)
for i, t in enumerate(rank, 1): r = rows[t]; print(f"#{i} {LAB[t]:20} score {100*r['score']:5.1f} | saved {100*r['savings']:4.1f}% kept {100*r['recall']:4.1f}% safety {100*r['safety']:4.1f}% overhead {r['overhead']:.0f}ms")


# ---- slimout across versions, by workload group (dev = used while building; holdout 1/2 = defined later, not used for tuning*) ----
old1, old2 = os.path.join(R, 'perf_v0.1.json'), os.path.join(R, 'perf_v0.2.json')
if os.path.exists(old1) and os.path.exists(old2):
    vers = [('slimout v0.1', json.load(open(old1))['results']['slimout'], '#C8E6C9'), ('slimout v0.2', json.load(open(old2))['results']['slimout'], '#66BB6A'), ('slimout v0.3', perf['results']['slimout'], '#2E7D32'), ('RTK 0.50.0', perf['results']['rtk'], '#1565C0')]
    groups = [('dev workloads (12)\nused while building', lambda w: not w.startswith('holdout')), ('holdout 1 (8)\nnot used for tuning', lambda w: w.startswith('holdout ')), ('holdout 2 (8)\n*see caveat', lambda w: w.startswith('holdout2'))]
    def g(rs, sel, k): return 100 * statistics.mean(max(0, r[k]) for r in rs if sel(r['wl']))
    fig, axs = plt.subplots(1, 2, figsize=(14, 4.8))
    for a, k, title in ((axs[0], 'savings', 'Tokens saved %'), (axs[1], 'recall', 'Information kept %')):
        xs = np.arange(len(groups)); w = 0.2
        for i, (lab, rs, c) in enumerate(vers):
            vals = [g(rs, sel, k) for _, sel in groups]; a.bar(xs + (i - 1.5) * w, vals, w, label=lab, color=c)
            for xi, v in zip(xs + (i - 1.5) * w, vals): a.text(xi, v + 1, f"{v:.0f}", ha='center', fontsize=8)
        a.set_xticks(xs); a.set_xticklabels([n for n, _ in groups], fontsize=9); a.set_ylim(0, 108); a.set_title(title, loc='left', fontweight='bold'); a.legend(fontsize=8.5, frameon=False, ncol=2, loc='upper right')
    fig.suptitle('slimout over versions vs RTK, by workload group', x=0.01, ha='left', fontweight='bold', y=1.02)
    fig.text(0.01, -0.04, "*holdout 2 was used to find a measuring flaw (diff needles used full paths; now basenames, applied to all tools and re-run) and v0.3's git-diff change was written after seeing v0.2's holdout-2 aggregates.", fontsize=8, color='#B71C1C')
    fig.savefig(os.path.join(R, 'before_after.png'), dpi=140, bbox_inches='tight'); plt.close(fig)
