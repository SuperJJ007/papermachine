"""Kaplan–Meier figure with risk table, Cox tables, and a matplotlib forest plot.

    exec(open(f"{SKILL_DIR}/scripts/km_cox.py").read())
    print(follow_up_summary(df, "time", "event"))
    fig, stats = km_plot(df, "time", "event", group="arm", time_label="Months", timepoints=[12, 36, 60])
    fig.savefig(f"{SCIENCE_ARTIFACT_DIR}/km_by_arm.png", dpi=150, bbox_inches="tight")
    uni, multi, cph = cox_table(df, "time", "event", covariates=["age", "C(sex)", "C(stage)"])
    ffig = forest_plot(multi, title="Multivariable Cox"); ffig.savefig(f"{SCIENCE_ARTIFACT_DIR}/forest.png", dpi=150, bbox_inches="tight")
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from lifelines import KaplanMeierFitter, CoxPHFitter
from lifelines.plotting import add_at_risk_counts
from lifelines.statistics import multivariate_logrank_test, pairwise_logrank_test
from lifelines.utils import median_survival_times


def follow_up_summary(df: pd.DataFrame, time: str, event: str) -> pd.Series:
    """n, events, censored, median follow-up by reverse Kaplan–Meier, and basic time checks."""
    t, e = df[time].astype(float), df[event].astype(int)
    rkm = KaplanMeierFitter().fit(t, 1 - e)
    return pd.Series({
        "n": len(df), "events": int(e.sum()), "censored": int((1 - e).sum()),
        "median_follow_up_reverse_km": rkm.median_survival_time_,
        "min_time": t.min(), "max_time": t.max(),
        "nonpositive_times": int((t <= 0).sum()), "missing_time_or_event": int(df[[time, event]].isna().any(axis=1).sum()),
    })


def km_plot(df: pd.DataFrame, time: str, event: str, group: str | None = None, time_label: str = "Time",
            timepoints: list[float] | None = None, ci: bool = True, title: str | None = None):
    """KM curves (per group) with CI bands, censor ticks, risk table, log-rank p in the legend.
    Returns (fig, stats) where stats holds medians with CI, time-point survival, and log-rank results."""
    fig, ax = plt.subplots(figsize=(7.5, 6))
    fitters, rows, tp_rows = [], [], []
    groups = [(None, df)] if group is None else list(df.groupby(group, observed=True))
    for name, sub in groups:
        label = "All" if name is None else f"{name} (n={len(sub)})"
        kmf = KaplanMeierFitter().fit(sub[time], sub[event], label=label)
        kmf.plot_survival_function(ax=ax, ci_show=ci, show_censors=True, censor_styles={"ms": 5, "marker": "|"})
        fitters.append(kmf)
        med = kmf.median_survival_time_
        med_ci = median_survival_times(kmf.confidence_interval_).iloc[0].tolist()
        rows.append({"group": "All" if name is None else name, "n": len(sub), "events": int(sub[event].sum()),
                     "median": "not reached" if np.isinf(med) else round(med, 2),
                     "median_lower95": "NR" if np.isinf(med_ci[0]) else round(med_ci[0], 2),
                     "median_upper95": "NR" if np.isinf(med_ci[1]) else round(med_ci[1], 2)})
        if timepoints:
            sf = kmf.survival_function_at_times(timepoints).values
            ci_df = kmf.confidence_interval_
            for tpt, s in zip(timepoints, sf):
                idx = ci_df.index[ci_df.index <= tpt].max() if (ci_df.index <= tpt).any() else ci_df.index[0]
                lo, hi = ci_df.loc[idx].tolist()
                tp_rows.append({"group": "All" if name is None else name, "time": tpt, "survival": round(s, 3),
                                "lower95": round(lo, 3), "upper95": round(hi, 3)})
    stats = {"medians": pd.DataFrame(rows), "timepoints": pd.DataFrame(tp_rows) if tp_rows else None}
    if group is not None and len(groups) > 1:
        lr = multivariate_logrank_test(df[time], df[group], df[event])
        stats["logrank"] = {"statistic": lr.test_statistic, "p": lr.p_value, "df": len(groups) - 1}
        if len(groups) > 2:
            stats["pairwise_logrank"] = pairwise_logrank_test(df[time], df[group], df[event]).summary
        ptxt = f"log-rank p = {lr.p_value:.3f}" if lr.p_value >= 0.001 else "log-rank p < 0.001"
        ax.text(0.02, 0.05, ptxt, transform=ax.transAxes, fontsize=10)
    ax.set_ylim(0, 1.02); ax.set_xlim(left=0)
    ax.set_xlabel(time_label); ax.set_ylabel("Survival probability")
    ax.set_title(title or ("Kaplan–Meier estimate" if group is None else f"Kaplan–Meier by {group}"))
    ax.grid(alpha=0.25)
    ax.legend(loc="upper right", frameon=False)
    add_at_risk_counts(*fitters, ax=ax, rows_to_show=["At risk"])
    fig.tight_layout()
    return fig, stats


def cox_table(df: pd.DataFrame, time: str, event: str, covariates: list[str], penalizer: float = 0.0):
    """Univariable Cox for each covariate and one multivariable model. `covariates` use lifelines
    formula syntax, e.g. ["age", "C(sex)", "C(stage)"]. Returns (uni_df, multi_df, fitted_multivariable_cph)."""
    def tidy(cph: CoxPHFitter, model: str) -> pd.DataFrame:
        s = cph.summary
        out = pd.DataFrame({
            "term": s.index, "HR": s["exp(coef)"].round(3),
            "lower95": s["exp(coef) lower 95%"].round(3), "upper95": s["exp(coef) upper 95%"].round(3),
            "p": s["p"].round(4), "model": model, "n": cph._n_examples, "events": int(cph.event_observed.sum()),
        })
        return out.reset_index(drop=True)
    uni = []
    for cov in covariates:
        cph = CoxPHFitter(penalizer=penalizer).fit(df, time, event, formula=cov)
        uni.append(tidy(cph, "univariable"))
    multi_cph = CoxPHFitter(penalizer=penalizer).fit(df, time, event, formula=" + ".join(covariates))
    multi = tidy(multi_cph, "multivariable")
    multi.attrs["concordance"] = multi_cph.concordance_index_
    return pd.concat(uni, ignore_index=True), multi, multi_cph


def forest_plot(table: pd.DataFrame, title: str = "Cox proportional hazards", label_col: str = "term"):
    """Forest plot of HR with 95% CI on a log axis from a `cox_table` output frame."""
    t = table.iloc[::-1].reset_index(drop=True)
    fig, ax = plt.subplots(figsize=(7.5, 0.5 * len(t) + 1.5))
    y = np.arange(len(t))
    ax.errorbar(t["HR"], y, xerr=[t["HR"] - t["lower95"], t["upper95"] - t["HR"]], fmt="s", color="black",
                ecolor="black", capsize=3, markersize=6)
    ax.axvline(1, ls="--", color="grey", lw=1)
    ax.set_xscale("log")
    ax.set_yticks(y); ax.set_yticklabels(t[label_col])
    ax.set_xlabel("Hazard ratio (95% CI, log scale)")
    for yi, (hr, lo, hi, p) in enumerate(zip(t["HR"], t["lower95"], t["upper95"], t["p"])):
        ptxt = "<0.001" if p < 0.001 else f"{p:.3f}"
        ax.text(1.02, yi, f"{hr:.2f} ({lo:.2f}–{hi:.2f})  p={ptxt}", transform=ax.get_yaxis_transform(), va="center", fontsize=8.5)
    ax.set_title(title, loc="left")
    fig.subplots_adjust(right=0.7)
    return fig
