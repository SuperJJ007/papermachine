"""Propensity-score toolkit.

    from propensity import estimate_ps, match_caliper, iptw_weights, balance_table, love_plot, weighted_effect, effective_n
    df["ps"] = estimate_ps(df, treat="tx", covariates=covs)
    m = match_caliper(df, treat="tx", ps="ps", caliper=0.2)
    bal = balance_table(df, m, treat="tx", covariates=covs); love_plot(bal, png=...)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from sklearn.neighbors import NearestNeighbors
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def estimate_ps(df, treat, covariates, formula_extra=""):
    f = f"{treat} ~ " + " + ".join(covariates) + (" + " + formula_extra if formula_extra else "")
    model = smf.logit(f, data=df).fit(disp=0)
    ps = model.predict(df)
    t, c = ps[df[treat] == 1], ps[df[treat] == 0]
    print(f"PS model c-statistic (for overlap diagnosis only): {_auc(df[treat], ps):.3f}")
    print(f"PS range treated {t.min():.3f}–{t.max():.3f}; control {c.min():.3f}–{c.max():.3f}; common support {max(t.min(), c.min()):.3f}–{min(t.max(), c.max()):.3f}")
    return ps


def _auc(y, s):
    from sklearn.metrics import roc_auc_score
    return roc_auc_score(y, s)


def match_caliper(df, treat, ps="ps", caliper=0.2, ratio=1, seed=0):
    """Greedy 1:k matching without replacement, retaining complete matched sets.

    Every retained treated subject and its k controls share one ``pair`` id.
    The caliper is a multiple of the full-sample logit-PS SD.
    """
    if not df.index.is_unique:
        raise ValueError('Matching requires a unique row index')
    if isinstance(ratio, bool) or not isinstance(ratio, (int, np.integer)) or ratio < 1:
        raise ValueError('ratio must be a positive integer')
    if not np.isfinite(caliper) or caliper < 0:
        raise ValueError('caliper must be finite and nonnegative')
    if df[treat].isna().any() or set(df[treat].unique()) != {0, 1}:
        raise ValueError('treatment must contain both 0 and 1 without missing values')
    if not np.isfinite(df[ps]).all() or not df[ps].between(0, 1, inclusive='neither').all():
        raise ValueError('propensity scores must be finite and strictly between 0 and 1')
    d = df.copy(); d["_lps"] = np.log(d[ps] / (1 - d[ps]))
    cal = caliper * d["_lps"].std()
    tr = d[d[treat] == 1].sample(frac=1, random_state=seed); co = d[d[treat] == 0].copy()
    nn = NearestNeighbors(radius=cal).fit(co[["_lps"]].values)
    used = set(); pair_id = {}; matched_sets = 0
    for idx, row in tr.iterrows():
        dist, ind = nn.radius_neighbors([[row["_lps"]]], sort_results=True)
        candidates = []
        for dd, ii in zip(dist[0], ind[0]):
            cidx = co.index[ii]
            if cidx in used or dd > cal:
                continue
            candidates.append(cidx)
            if len(candidates) == ratio:
                break
        if len(candidates) != ratio:
            continue
        pair_id[idx] = matched_sets
        for cidx in candidates:
            used.add(cidx)
            pair_id[cidx] = matched_sets
        matched_sets += 1
    m = d.loc[list(pair_id)].copy(); m["pair"] = m.index.map(pair_id)
    print(f"Matched {m[treat].sum()} of {len(tr)} treated ({m[treat].sum()/len(tr):.1%}) to {int((m[treat]==0).sum())} controls; caliper = {cal:.3f} on logit PS")
    return m.drop(columns="_lps")


def iptw_weights(df, treat, ps="ps", estimand="ATE", stabilize=True, truncate=(0.01, 0.99)):
    t = df[treat].values; p = df[ps].values
    if estimand == "ATE":
        w = np.where(t == 1, 1 / p, 1 / (1 - p))
        if stabilize:
            w = np.where(t == 1, t.mean() / p, (1 - t.mean()) / (1 - p))
    elif estimand == "ATT":
        w = np.where(t == 1, 1.0, p / (1 - p))
    elif estimand == "ATO":
        w = np.where(t == 1, 1 - p, p)
    else:
        raise ValueError(estimand)
    if truncate and estimand != "ATO":
        lo, hi = np.quantile(w, truncate); n_tr = int(((w < lo) | (w > hi)).sum()); w = np.clip(w, lo, hi)
        print(f"Truncated {n_tr} weights to [{lo:.2f}, {hi:.2f}]")
    print(f"{estimand} weights: mean {w.mean():.2f}, max {w.max():.2f}; effective n treated = {effective_n(w[t==1]):.0f}, control = {effective_n(w[t==0]):.0f}")
    return w


def effective_n(w):
    w = np.asarray(w); return w.sum() ** 2 / (w ** 2).sum()


def _smd(x1, x0, w1=None, w0=None):
    def prepare(x, w):
        x = np.asarray(x, dtype=float)
        w = np.ones(len(x)) if w is None else np.asarray(w, dtype=float)
        if x.shape != w.shape or x.ndim != 1:
            raise ValueError('SMD observations and weights must be aligned vectors')
        if not np.isfinite(w).all() or (w < 0).any() or np.isinf(x).any():
            raise ValueError('SMD requires finite nonnegative weights and no infinite observations')
        keep = ~np.isnan(x) & (w > 0)
        return x[keep], w[keep]
    x1, w1 = prepare(x1, w1); x0, w0 = prepare(x0, w0)
    if not len(x1) or not len(x0):
        return float('nan')
    m1, m0 = np.average(x1, weights=w1), np.average(x0, weights=w0)
    v1, v0 = np.average((x1 - m1) ** 2, weights=w1), np.average((x0 - m0) ** 2, weights=w0)
    s = np.sqrt((v1 + v0) / 2)
    return abs(m1 - m0) / s if s > 0 else (0.0 if m1 == m0 else float('inf'))


def balance_table(before, after, treat, covariates, weights=None):
    """after: matched df (weights=None) or same df with weights array."""
    rows = []
    for c in covariates:
        categorical = before[c].dtype == object or str(before[c].dtype) in ('category', 'string')
        x = pd.get_dummies(before[c], drop_first=False, dtype=float) if categorical else before[[c]]
        xa = pd.get_dummies(after[c], drop_first=False, dtype=float).reindex(columns=x.columns, fill_value=0) if categorical else after[[c]]
        if categorical:
            x.loc[before[c].isna(), :] = np.nan
            xa.loc[after[c].isna(), :] = np.nan
        for col in x.columns:
            b = _smd(x.loc[before[treat] == 1, col].astype(float).values, x.loc[before[treat] == 0, col].astype(float).values)
            if weights is None:
                a = _smd(xa.loc[after[treat] == 1, col].astype(float).values, xa.loc[after[treat] == 0, col].astype(float).values)
            else:
                a = _smd(xa.loc[after[treat] == 1, col].astype(float).values, xa.loc[after[treat] == 0, col].astype(float).values,
                         weights[(after[treat] == 1).values], weights[(after[treat] == 0).values])
            rows.append({"covariate": f"{c}" if x.shape[1] == 1 else f"{c}={col}", "smd_before": b, "smd_after": a})
    tbl = pd.DataFrame(rows)
    print(tbl.round(3).to_string(index=False))
    print('SMD: inf means complete separation; nan means insufficient data. Neither means balanced.')
    bad = tbl[tbl.smd_after > 0.1]
    print(f"Covariates with SMD > 0.1 after adjustment: {len(bad)}" + (f" → {', '.join(bad.covariate)}" if len(bad) else ""))
    return tbl


def love_plot(bal, png):
    b = bal.sort_values("smd_before")
    fig, ax = plt.subplots(figsize=(7, 0.3 * len(b) + 1.5))
    y = np.arange(len(b))
    # Do not silently drop non-finite SMDs: complete separation must remain visible.
    finite = b[["smd_before", "smd_after"]].to_numpy()
    finite = finite[np.isfinite(finite)]
    edge = max(0.2, float(finite.max()) * 1.15) if finite.size else 0.2
    for column, label, color, offset in [("smd_before", "Before", "black", -0.12), ("smd_after", "After", "steelblue", 0.12)]:
        values = b[column].to_numpy(dtype=float)
        ok = np.isfinite(values)
        ax.scatter(values[ok], y[ok] + offset, marker="o", facecolors="none" if label == "Before" else color, edgecolors=color, label=label)
        for row in np.flatnonzero(~ok):
            ax.annotate(f"{label}: separated" if np.isinf(values[row]) else f"{label}: insufficient", (edge, y[row]+offset), fontsize=7, color=color)
    ax.set_xlim(left=0, right=edge * 1.75)
    ax.axvline(0.1, ls="--", color="grey"); ax.set_yticks(y); ax.set_yticklabels(b.covariate, fontsize=8)
    ax.set_xlabel("Absolute standardized mean difference"); ax.legend(); ax.set_title("Covariate balance (Love plot)")
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)


def weighted_effect(df, outcome, treat, weights=None, cluster=None, family="gaussian"):
    """Marginal effect with robust (HC1) or cluster-robust SE. family: gaussian → mean difference; binomial → OR + risk difference."""
    X = sm.add_constant(df[[treat]].astype(float))
    fam = sm.families.Binomial() if family == "binomial" else sm.families.Gaussian()
    kw = {"cov_type": "cluster", "cov_kwds": {"groups": df[cluster].values}} if cluster else {"cov_type": "HC1"}
    res = sm.GLM(df[outcome].astype(float), X, family=fam, freq_weights=weights).fit(**kw)
    b, se = res.params[treat], res.bse[treat]; ci = (b - 1.96 * se, b + 1.96 * se)
    if family == "binomial":
        p1 = res.predict(pd.DataFrame({"const": 1.0, treat: [1.0]}))[0]; p0 = res.predict(pd.DataFrame({"const": 1.0, treat: [0.0]}))[0]
        print(f"OR = {np.exp(b):.3f} (95% CI {np.exp(ci[0]):.3f}–{np.exp(ci[1]):.3f}), p = {res.pvalues[treat]:.4f}; risk {p1:.3f} vs {p0:.3f}, RD = {p1-p0:.3f}")
    else:
        print(f"Mean difference = {b:.3f} (95% CI {ci[0]:.3f} to {ci[1]:.3f}), p = {res.pvalues[treat]:.4f}")
    return res
