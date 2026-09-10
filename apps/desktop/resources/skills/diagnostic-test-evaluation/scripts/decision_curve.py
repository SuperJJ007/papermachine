"""Decision curve analysis (Vickers & Elkin 2006).

    from decision_curve import decision_curve
    decision_curve(y_true, {"Model A": p_a, "Model B": p_b}, png=os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "dca.png"))
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def net_benefit(y, p, thresholds):
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float); n = len(y)
    out = []
    for t in thresholds:
        pred = p >= t
        tp = np.sum(pred & (y == 1)); fp = np.sum(pred & (y == 0))
        out.append(tp / n - fp / n * (t / (1 - t)))
    return np.array(out)


def decision_curve(y_true, models: dict, thresholds=None, png=None):
    thresholds = np.linspace(0.01, 0.6, 60) if thresholds is None else np.asarray(thresholds)
    y = np.asarray(y_true).astype(int); prev = y.mean()
    nb_all = prev - (1 - prev) * thresholds / (1 - thresholds)
    df = pd.DataFrame({"threshold": thresholds, "treat_all": nb_all, "treat_none": 0.0})
    for name, p in models.items():
        df[name] = net_benefit(y, p, thresholds)
    for name in models:
        useful = df.loc[df[name] > np.maximum(df.treat_all, 0), "threshold"]
        rng = f"{useful.min():.2f}–{useful.max():.2f}" if len(useful) else "none"
        print(f"{name}: net benefit exceeds both default strategies for thresholds {rng}")
    if png:
        fig, ax = plt.subplots(figsize=(7, 5))
        ax.plot(thresholds, nb_all, color="grey", label="Treat all"); ax.axhline(0, color="black", lw=1, label="Treat none")
        for name in models:
            ax.plot(thresholds, df[name], lw=2, label=name)
        ax.set_ylim(bottom=-0.05); ax.set_xlabel("Threshold probability"); ax.set_ylabel("Net benefit"); ax.legend()
        ax.set_title("Decision curve analysis")
        fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
    return df
