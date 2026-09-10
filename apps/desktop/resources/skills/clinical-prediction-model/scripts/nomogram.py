"""Points-based score and simple nomogram from a statsmodels Logit result.

    from nomogram import points_table, draw_nomogram
    tbl = points_table(result, ranges={"age": (30, 90), "sbp": (90, 200)}, categorical={"diabetes": [0, 1]})
    draw_nomogram(result, ranges, categorical, png=...)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _contrib(params, ranges, categorical):
    contrib = {}
    for name, (lo, hi) in ranges.items():
        b = params[name]; contrib[name] = (b * lo, b * hi)
    for name, levels in categorical.items():
        b = params.get(name, 0.0); contrib[name] = (min(b * l for l in levels), max(b * l for l in levels))
    return contrib


def points_table(result, ranges: dict, categorical: dict, max_points=100):
    params = result.params
    contrib = _contrib(params, ranges, categorical)
    span = max(hi - lo for lo, hi in contrib.values())
    rows = []
    for name, (lo, hi) in ranges.items():
        for v in np.linspace(lo, hi, 7):
            rows.append({"variable": name, "value": round(float(v), 2), "points": round((params[name] * v - contrib[name][0]) / span * max_points, 1)})
    for name, levels in categorical.items():
        for l in levels:
            rows.append({"variable": name, "value": l, "points": round((params.get(name, 0.0) * l - contrib[name][0]) / span * max_points, 1)})
    tbl = pd.DataFrame(rows)
    total_min = params["const"] + sum(lo for lo, _ in contrib.values())
    print(tbl.to_string(index=False))
    print(f"Risk = 1 / (1 + exp(-(linear predictor))); linear predictor = {total_min:.4f} + total_points × {span/max_points:.5f}")
    return tbl


def draw_nomogram(result, ranges, categorical, png, max_points=100):
    params = result.params; contrib = _contrib(params, ranges, categorical)
    span = max(hi - lo for lo, hi in contrib.values())
    names = list(ranges) + list(categorical); n = len(names)
    fig, ax = plt.subplots(figsize=(10, 0.7 * n + 3)); ax.set_xlim(-25, max_points + 5); ax.set_ylim(-3, n + 1); ax.axis("off")
    ax.plot([0, max_points], [n, n], color="black"); ax.text(-24, n, "Points", va="center", fontweight="bold")
    for t in range(0, max_points + 1, 10):
        ax.plot([t, t], [n - 0.1, n + 0.1], color="black"); ax.text(t, n + 0.25, str(t), ha="center", fontsize=7)
    for i, name in enumerate(names):
        y = n - 1 - i; lo, hi = contrib[name]
        if name in ranges:
            vlo, vhi = ranges[name]; b = params[name]
            ticks = np.linspace(vlo, vhi, 6)
            xs = (b * ticks - lo) / span * max_points
        else:
            ticks = np.array(categorical[name]); b = params.get(name, 0.0); xs = (b * ticks - lo) / span * max_points
        ax.plot([xs.min(), xs.max()], [y, y], color="black"); ax.text(-24, y, name, va="center")
        for x, t in zip(xs, ticks):
            ax.plot([x, x], [y - 0.1, y + 0.1], color="black"); ax.text(x, y + 0.2, f"{t:g}", ha="center", fontsize=7)
    total_min = params["const"] + sum(lo for lo, _ in contrib.values())
    ax.plot([0, max_points * n], [-1.5, -1.5], color="black", clip_on=False); ax.text(-24, -1.5, "Total points", va="center", fontweight="bold")
    risk_ticks = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
    ax.plot([0, max_points * n], [-2.7, -2.7], color="black", clip_on=False); ax.text(-24, -2.7, "Predicted risk", va="center", fontweight="bold")
    for r in risk_ticks:
        lp = np.log(r / (1 - r)); tp = (lp - total_min) * max_points / span
        if 0 <= tp <= max_points * n:
            ax.plot([tp, tp], [-2.8, -2.6], color="black", clip_on=False); ax.text(tp, -3.1, f"{r:.0%}", ha="center", fontsize=7)
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
