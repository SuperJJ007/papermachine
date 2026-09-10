"""Pre-specified subgroup analysis with interaction tests and a forest plot.

    from subgroup_forest import subgroup_analysis
    res = subgroup_analysis(df, outcome="response", arm="arm", subgroups=["sex","age_group","stage"],
                            family="binomial", covariates=["site"],
                            png=os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "subgroups.png"))
Declare subgroups.png in raster_artifacts. family: "binomial" (OR) or "gaussian" (mean difference).
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _fit(formula, data, family):
    if family == "binomial":
        import statsmodels.api as sm
        return smf.glm(formula, data=data, family=sm.families.Binomial()).fit()
    return smf.ols(formula, data=data).fit()


def subgroup_analysis(df, outcome, arm, subgroups, family="binomial", covariates=None, png=None):
    covariates = covariates or []
    cov = "".join(f" + C({c})" for c in covariates)
    rows = []
    overall = _fit(f"{outcome} ~ C({arm}){cov}", df, family)
    term = [t for t in overall.params.index if t.startswith(f"C({arm})")][0]
    est, ci = overall.params[term], overall.conf_int().loc[term]
    rows.append({"subgroup": "Overall", "level": "", "n": len(df), "est": est, "lo": ci[0], "hi": ci[1], "p_int": np.nan})
    for sg in subgroups:
        inter = _fit(f"{outcome} ~ C({arm}) * C({sg}){cov}", df, family)
        base = _fit(f"{outcome} ~ C({arm}) + C({sg}){cov}", df, family)
        if family == "binomial":
            lr = 2 * (inter.llf - base.llf); df_diff = inter.df_model - base.df_model
            from scipy import stats
            p_int = 1 - stats.chi2.cdf(lr, df_diff)
        else:
            from statsmodels.stats.anova import anova_lm
            p_int = anova_lm(base, inter).iloc[1]["Pr(>F)"]
        for lvl, sub in df.groupby(sg):
            if sub[arm].nunique() < 2:
                continue
            m = _fit(f"{outcome} ~ C({arm}){cov}", sub, family)
            t = [t for t in m.params.index if t.startswith(f"C({arm})")][0]
            c = m.conf_int().loc[t]
            rows.append({"subgroup": sg, "level": str(lvl), "n": len(sub), "est": m.params[t], "lo": c[0], "hi": c[1], "p_int": p_int})
    res = pd.DataFrame(rows)
    if family == "binomial":
        for c in ("est", "lo", "hi"):
            res[c] = np.exp(res[c])
    print(res.to_string(index=False))
    if png:
        _forest(res, png, log=(family == "binomial"))
    return res


def _forest(res, png, log):
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(res) + 1.5))
    y = np.arange(len(res))[::-1]
    ax.errorbar(res["est"], y, xerr=[res["est"] - res["lo"], res["hi"] - res["est"]], fmt="s", color="black", capsize=3)
    ax.axvline(1 if log else 0, ls="--", color="grey")
    if log:
        ax.set_xscale("log")
    labels = [f"{r.subgroup} {r.level} (n={r.n})" + (f"  p-int={r.p_int:.3f}" if r.level and not np.isnan(r.p_int) else "") for r in res.itertuples()]
    ax.set_yticks(y); ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("Odds ratio (95% CI)" if log else "Mean difference (95% CI)")
    ax.set_title("Subgroup analysis — interpret the interaction p-values, not the individual CIs")
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
