"""Cox proportional-hazards model with PH diagnostics and HR forest plot.

    from cox_model import fit_cox
    cph = fit_cox(df, time="os_months", event="death", covariates=["arm","age","stage"],
                  strata=None, png=os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "cox_forest.png"))
Categorical covariates must be dummy-coded first (pd.get_dummies(drop_first=True)).
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from lifelines import CoxPHFitter
from lifelines.statistics import proportional_hazard_test
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def fit_cox(df, time, event, covariates, strata=None, png=None, penalizer=0.0):
    cols = [time, event] + covariates + (strata or [])
    data = df[cols].dropna()
    n_events = int(data[event].sum())
    n_params = len(covariates)
    epv = n_events / max(n_params, 1)
    print(f"n = {len(data)}, events = {n_events}, parameters = {n_params}, events per variable = {epv:.1f}"
          + ("  ⚠ EPV < 10: overfitting risk, consider penalization or fewer covariates" if epv < 10 else ""))
    cph = CoxPHFitter(penalizer=penalizer)
    cph.fit(data, duration_col=time, event_col=event, strata=strata)
    s = cph.summary[["exp(coef)", "exp(coef) lower 95%", "exp(coef) upper 95%", "p"]]
    s.columns = ["HR", "lo95", "hi95", "p"]
    print(s.round(4).to_string())
    print(f"Concordance index: {cph.concordance_index_:.3f}")
    ph = proportional_hazard_test(cph, data, time_transform="rank")
    print("\nSchoenfeld PH test (p < 0.05 suggests violation):")
    print(ph.summary[["test_statistic", "p"]].round(4).to_string())
    violators = ph.summary.index[ph.summary["p"] < 0.05].tolist()
    if violators:
        print(f"⚠ PH violated for: {violators}. Options: strata(), time-varying coefficient, piecewise HR, or RMST.")
    if png:
        fig, ax = plt.subplots(figsize=(7, 0.5 * len(s) + 1.5))
        y = np.arange(len(s))[::-1]
        ax.errorbar(s["HR"], y, xerr=[s["HR"] - s["lo95"], s["hi95"] - s["HR"]], fmt="s", color="black", capsize=3)
        ax.axvline(1, ls="--", color="grey"); ax.set_xscale("log")
        ax.set_yticks(y); ax.set_yticklabels([f"{i}  HR {r.HR:.2f} ({r.lo95:.2f}–{r.hi95:.2f}) p={r.p:.3f}" for i, r in s.iterrows()], fontsize=8)
        ax.set_xlabel("Hazard ratio (95% CI)"); ax.set_title("Cox proportional-hazards model")
        fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
    return cph
