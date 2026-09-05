"""qPCR relative quantification (ΔΔCt, Pfaffl), geNorm M, and standard-curve efficiency;
plus logistic growth-curve fitting with doubling time.

    exec(open(f"{SKILL_DIR}/scripts/qpcr.py").read())
    long = tidy_ct(df)   # columns: sample, group, gene, replicate, ct   (ct NaN for Undetermined)
    res = ddct(long, target="IL6", references=["GAPDH", "ACTB"], calibrator_group="control")
    eff = efficiency_from_standard_curve(log10_input, ct)
    M = genorm_m(long, genes=["GAPDH", "ACTB", "B2M", "HPRT1"])
    g = fit_logistic(t_hours, od600); g["doubling_time"], g["lag"], g["K"]
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import curve_fit

UNDETERMINED_CT = 40.0   # treat Ct >= this as a non-detect


def tidy_ct(df: pd.DataFrame, ct_col: str = "ct") -> pd.DataFrame:
    """Coerce 'Undetermined'/'NaN'/'>40' to NaN and Ct >= UNDETERMINED_CT to NaN; keep a `nondetect` flag."""
    out = df.copy()
    out[ct_col] = pd.to_numeric(out[ct_col], errors="coerce")
    out["nondetect"] = out[ct_col].isna() | (out[ct_col] >= UNDETERMINED_CT)
    out.loc[out["nondetect"], ct_col] = np.nan
    return out


def _tech_mean(long: pd.DataFrame) -> pd.DataFrame:
    """Average technical replicates per (sample, gene); flag SD > 0.5 cycles."""
    g = long.groupby(["sample", "group", "gene"], observed=True)["ct"]
    agg = g.agg(ct_mean="mean", ct_sd="std", n_tech="count", n_nondetect=lambda s: s.isna().sum()).reset_index()
    agg["flag_tech_sd_gt_0.5"] = agg["ct_sd"] > 0.5
    return agg


def ddct(long: pd.DataFrame, target: str, references: list[str], calibrator_group: str,
         efficiencies: dict[str, float] | None = None) -> dict:
    """2^-ΔΔCt (or Pfaffl when `efficiencies` gives per-gene E as a fraction, e.g. 0.97) with statistics on ΔCt.
    Returns {"per_sample": DataFrame, "summary": DataFrame (fold change with 95% CI per group), "test": dict}."""
    tm = _tech_mean(long)
    wide = tm.pivot_table(index=["sample", "group"], columns="gene", values="ct_mean").reset_index()
    ref_ct = wide[references].mean(axis=1) if efficiencies is None else np.log2(
        np.prod([(1 + efficiencies[r]) ** (-wide[r]) for r in references], axis=0) ** (1 / len(references))) * -1
    # ΔCt = Ct_target − geometric-mean-equivalent Ct_ref  (arithmetic mean of Ct == geometric mean of quantities)
    wide["dct"] = wide[target] - ref_ct
    cal = wide.loc[wide["group"] == calibrator_group, "dct"]
    if cal.empty:
        raise ValueError(f"calibrator group '{calibrator_group}' has no samples")
    wide["ddct"] = wide["dct"] - cal.mean()
    e_t = 2.0 if efficiencies is None else 1 + efficiencies[target]
    wide["fold_change"] = e_t ** (-wide["ddct"])
    wide["nondetect_target"] = wide[target].isna()

    rows = []
    for grp, sub in wide.groupby("group", observed=True):
        d = sub["ddct"].dropna()
        n = len(d)
        if n >= 2:
            se = d.std(ddof=1) / np.sqrt(n); t = stats.t.ppf(0.975, n - 1)
            lo, hi = d.mean() - t * se, d.mean() + t * se
        else:
            lo = hi = np.nan
        rows.append(dict(group=grp, n_bio=n, mean_ddct=d.mean(), fold_change=e_t ** (-d.mean()),
                         fc_lower95=e_t ** (-hi), fc_upper95=e_t ** (-lo)))
    summary = pd.DataFrame(rows)

    test = {}
    groups = [g for g in wide["group"].unique() if g != calibrator_group]
    for grp in groups:
        a = wide.loc[wide.group == calibrator_group, "dct"].dropna(); b = wide.loc[wide.group == grp, "dct"].dropna()
        if len(a) >= 2 and len(b) >= 2:
            t = stats.ttest_ind(b, a, equal_var=False)
            test[grp] = dict(comparison=f"{grp} vs {calibrator_group}", welch_t=t.statistic, p=t.pvalue, scale="ΔCt")
    return {"per_sample": wide, "summary": summary, "test": test, "technical": tm}


def efficiency_from_standard_curve(log10_input, ct) -> dict:
    """Slope/intercept/R² of Ct vs log10(input) and amplification efficiency E = 10^(−1/slope) − 1."""
    x = np.asarray(log10_input, float); y = np.asarray(ct, float)
    m = np.isfinite(x) & np.isfinite(y)
    res = stats.linregress(x[m], y[m])
    eff = 10 ** (-1 / res.slope) - 1
    return dict(slope=res.slope, intercept=res.intercept, r2=res.rvalue ** 2, efficiency=eff,
                efficiency_pct=100 * eff, acceptable=(0.90 <= eff <= 1.10) and res.rvalue ** 2 >= 0.98)


def genorm_m(long: pd.DataFrame, genes: list[str]) -> pd.Series:
    """geNorm stability measure M per candidate reference gene (lower = more stable; < 0.5 homogeneous samples)."""
    tm = _tech_mean(long)
    wide = tm.pivot_table(index="sample", columns="gene", values="ct_mean")[genes]
    q = 2.0 ** (-wide)                                      # relative quantities
    M = {}
    for g in genes:
        vs = [np.log2(q[g] / q[h]).std(ddof=1) for h in genes if h != g]
        M[g] = float(np.mean(vs))
    return pd.Series(M, name="geNorm_M").sort_values()


# --- growth curves ---------------------------------------------------------------

def logistic(t, K, N0, r):
    return K / (1 + ((K - N0) / N0) * np.exp(-r * t))


def fit_logistic(t, od, blank: float = 0.0) -> dict:
    """Logistic fit on blank-subtracted OD; doubling time from r and from the best log-linear window; lag time
    by the tangent-at-max-slope method; AUC as a model-free summary."""
    t = np.asarray(t, float); y = np.asarray(od, float) - blank
    m = np.isfinite(t) & np.isfinite(y) & (y > 0)
    t, y = t[m], y[m]
    p0 = [y.max(), max(y[0], 1e-4), 0.5]
    popt, pcov = curve_fit(logistic, t, y, p0=p0, bounds=([0, 1e-6, 1e-4], [np.inf, np.inf, 50]), maxfev=20000)
    K, N0, r = popt
    perr = np.sqrt(np.diag(pcov))
    # best exponential window: maximize R² of log(y) ~ t over windows of >= 5 points
    best = None
    ly = np.log(y)
    for w in range(5, len(t) + 1):
        for i in range(0, len(t) - w + 1):
            lr = stats.linregress(t[i:i + w], ly[i:i + w])
            if lr.slope > 0 and (best is None or lr.rvalue ** 2 > best[0]):
                best = (lr.rvalue ** 2, lr.slope, t[i], t[i + w - 1])
    mu_max = best[1] if best else np.nan
    # lag: tangent at the point of maximum slope of the fitted curve intersects baseline N0
    grid = np.linspace(t.min(), t.max(), 1000); fit_y = logistic(grid, *popt)
    slope = np.gradient(fit_y, grid); k = int(np.argmax(slope))
    lag = grid[k] - (fit_y[k] - N0) / slope[k] if slope[k] > 0 else np.nan
    yhat = logistic(t, *popt); r2 = 1 - np.sum((y - yhat) ** 2) / np.sum((y - y.mean()) ** 2)
    return dict(K=K, N0=N0, r=r, se=dict(K=perr[0], N0=perr[1], r=perr[2]),
                doubling_time_model=np.log(2) / r, doubling_time_window=np.log(2) / mu_max if mu_max else np.nan,
                window=(best[2], best[3], best[0]) if best else None, lag=max(lag, 0) if np.isfinite(lag) else np.nan,
                auc=np.trapz(y, t), r2=r2, predict=lambda tt: logistic(np.asarray(tt, float), *popt))
