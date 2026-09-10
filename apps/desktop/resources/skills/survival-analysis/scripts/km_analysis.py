"""Kaplan-Meier analysis with number-at-risk table.

    from km_analysis import km_by_group, median_follow_up
    km_by_group(df, time="os_months", event="death", group="arm",
                png=os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "km_os.png"), timepoints=[12, 36, 60])
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from lifelines import KaplanMeierFitter
from lifelines.statistics import logrank_test, multivariate_logrank_test
from lifelines.plotting import add_at_risk_counts
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def median_follow_up(df, time, event):
    """Reverse Kaplan-Meier (Schemper & Smith)."""
    kmf = KaplanMeierFitter().fit(df[time], 1 - df[event].astype(int))
    print(f"Median follow-up (reverse KM): {kmf.median_survival_time_:.2f}")
    return kmf.median_survival_time_


def km_by_group(df, time, event, group=None, png=None, timepoints=(12, 36, 60), ci_show=True, xlabel="Time"):
    fig, ax = plt.subplots(figsize=(8, 6))
    fitters, rows = [], []
    groups = [None] if group is None else list(pd.unique(df[group].dropna()))
    for g in groups:
        sub = df if g is None else df[df[group] == g]
        kmf = KaplanMeierFitter(label=str(g) if g is not None else "All")
        kmf.fit(sub[time], sub[event], alpha=0.05)
        kmf.plot_survival_function(ax=ax, ci_show=ci_show)
        fitters.append(kmf)
        med = kmf.median_survival_time_
        from lifelines.utils import median_survival_times
        mci = median_survival_times(kmf.confidence_interval_)
        row = {"group": kmf._label, "n": len(sub), "events": int(sub[event].sum()),
               "median": med, "median_lo": float(mci.iloc[0, 0]), "median_hi": float(mci.iloc[0, 1])}
        for tp in timepoints:
            sf = kmf.survival_function_at_times(tp).iloc[0]
            row[f"S({tp})"] = sf
        rows.append(row)
    summary = pd.DataFrame(rows)
    print(summary.to_string(index=False))
    if group is not None and len(groups) >= 2:
        if len(groups) == 2:
            a, b = [df[df[group] == g] for g in groups]
            lr = logrank_test(a[time], b[time], a[event], b[event])
        else:
            lr = multivariate_logrank_test(df[time], df[group], df[event])
        print(f"Log-rank: chi2 = {lr.test_statistic:.3f}, p = {lr.p_value:.4f}")
        ax.text(0.02, 0.05, f"Log-rank p = {lr.p_value:.3f}", transform=ax.transAxes)
    ax.set_xlabel(xlabel); ax.set_ylabel("Survival probability"); ax.set_ylim(0, 1.02)
    add_at_risk_counts(*fitters, ax=ax, rows_to_show=["At risk"])
    plt.tight_layout()
    if png:
        fig.savefig(png, dpi=200, bbox_inches="tight")
    plt.close(fig)
    return summary
