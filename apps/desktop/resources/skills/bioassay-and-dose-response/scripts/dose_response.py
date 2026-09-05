"""4PL dose–response fitting with CIs, inverse prediction for standard curves, and a standard figure.

    exec(open(f"{SKILL_DIR}/scripts/dose_response.py").read())
    fit = fit_4pl(x_conc, y_response, fix_top=100, fix_bottom=0)     # normalized data
    fit["ic50"], fit["ic50_ci95"], fit["hill"], fit["r2"]
    fig = plot_dose_response({"Drug A": (xa, ya, fit_a), "Drug B": (xb, yb, fit_b)}, x_label="Concentration (µM)")
    conc = inverse_predict(fit_std, y_unknown)                          # standards → unknowns with 95% PI
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit
from scipy import stats


def four_pl(logx, bottom, top, logic50, hill):
    return bottom + (top - bottom) / (1 + 10 ** ((logic50 - logx) * hill))


def fit_4pl(x, y, fix_top=None, fix_bottom=None, weights=None) -> dict:
    """Fit a 4PL on log10(x). x must be > 0 (drop the zero-dose control or handle it via fix_top/fix_bottom).
    Returns dict with parameters, SEs, 95% CIs (IC50 CI back-transformed from log scale), r2, residual SD, n, and
    a callable `predict(x)`. `weights` = 1/SD per point for weighted least squares if replicate SDs are known."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    mask = np.isfinite(x) & np.isfinite(y) & (x > 0)
    x, y = x[mask], y[mask]
    lx = np.log10(x)
    p0 = [np.nanmin(y) if fix_bottom is None else fix_bottom, np.nanmax(y) if fix_top is None else fix_top,
          np.mean(lx), 1.0]

    free = [fix_bottom is None, fix_top is None, True, True]
    names = np.array(["bottom", "top", "logic50", "hill"])

    def model(lx_, *params):
        full = list(p0)
        it = iter(params)
        for i, f in enumerate(free):
            if f:
                full[i] = next(it)
        return four_pl(lx_, *full)

    p0_free = [p for p, f in zip(p0, free) if f]
    lower = [-np.inf if n != "hill" else 0.05 for n, f in zip(names, free) if f]
    upper = [np.inf if n != "hill" else 10 for n, f in zip(names, free) if f]
    sigma = None if weights is None else 1 / np.asarray(weights, float)[mask]
    popt, pcov = curve_fit(model, lx, y, p0=p0_free, bounds=(lower, upper), sigma=sigma, maxfev=20000)
    if not np.all(np.isfinite(pcov)):
        raise RuntimeError("4PL fit did not converge to a well-conditioned solution; check the dose range and plateaus")
    perr = np.sqrt(np.diag(pcov))
    dof = max(len(y) - len(popt), 1)
    tcrit = stats.t.ppf(0.975, dof)
    full = list(p0); se = [0.0] * 4; it = iter(range(len(popt)))
    for i, f in enumerate(free):
        if f:
            k = next(it); full[i] = popt[k]; se[i] = perr[k]
    bottom, top, logic50, hill = full
    yhat = four_pl(lx, *full)
    ss_res = np.sum((y - yhat) ** 2); ss_tot = np.sum((y - y.mean()) ** 2)
    ic50_ci = (10 ** (logic50 - tcrit * se[2]), 10 ** (logic50 + tcrit * se[2]))
    x_range = (x.min(), x.max())
    plateau_note = None
    if 10 ** logic50 < x_range[0] or 10 ** logic50 > x_range[1]:
        plateau_note = "IC50 lies outside the tested dose range — report as not estimable"
    result = dict(bottom=bottom, top=top, logic50=logic50, ic50=10 ** logic50, ic50_ci95=ic50_ci, hill=hill,
                  se=dict(zip(names, se)), r2=1 - ss_res / ss_tot if ss_tot > 0 else np.nan,
                  residual_sd=np.sqrt(ss_res / dof), n=len(y), dof=dof, fixed=dict(top=fix_top, bottom=fix_bottom),
                  dose_range=x_range, warning=plateau_note,
                  predict=lambda xx: four_pl(np.log10(np.asarray(xx, float)), bottom, top, logic50, hill),
                  _cov=pcov, _free=free, _p0=p0)
    return result


def inverse_predict(fit: dict, y_new, level: float = 0.95) -> pd.DataFrame:
    """Back-calculate concentrations from responses on a fitted 4PL standard curve, with an approximate
    prediction interval (delta method on log10 x plus residual SD). Flags out-of-range values."""
    bottom, top, logic50, hill = fit["bottom"], fit["top"], fit["logic50"], fit["hill"]
    y_new = np.asarray(y_new, float)
    rows = []
    lo_y, hi_y = sorted([bottom, top])
    for yv in y_new:
        if not (lo_y < yv < hi_y):
            rows.append(dict(response=yv, conc=np.nan, conc_lower=np.nan, conc_upper=np.nan, flag="outside curve asymptotes"))
            continue
        ratio = (top - bottom) / (yv - bottom) - 1
        lx = logic50 - np.log10(ratio) / hill
        # slope dy/dlogx at lx, for an approximate interval from the residual SD
        h = 1e-4
        slope = (four_pl(lx + h, bottom, top, logic50, hill) - four_pl(lx - h, bottom, top, logic50, hill)) / (2 * h)
        tcrit = stats.t.ppf(0.5 + level / 2, fit["dof"])
        half = tcrit * fit["residual_sd"] / abs(slope) if slope != 0 else np.inf
        conc = 10 ** lx
        flag = ""
        if conc < fit["dose_range"][0] or conc > fit["dose_range"][1]:
            flag = "outside calibrated range — extrapolated"
        rows.append(dict(response=yv, conc=conc, conc_lower=10 ** (lx - half), conc_upper=10 ** (lx + half), flag=flag))
    return pd.DataFrame(rows)


def plot_dose_response(curves: dict, x_label: str = "Concentration", y_label: str = "Response (% of control)",
                       title: str = "Dose–response", show_ic50: bool = True):
    """curves: {label: (x, y, fit_dict)} — raw points plotted as mean ± SD per dose, fitted curve on top,
    IC50 marked with its CI as a horizontal bar at the half-max level."""
    fig, ax = plt.subplots(figsize=(7, 5))
    palette = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    for i, (label, (x, y, fit)) in enumerate(curves.items()):
        c = palette[i % len(palette)]
        df = pd.DataFrame({"x": np.asarray(x, float), "y": np.asarray(y, float)})
        df = df[df.x > 0]
        agg = df.groupby("x")["y"].agg(["mean", "std", "count"]).reset_index()
        ax.errorbar(agg["x"], agg["mean"], yerr=agg["std"], fmt="o", color=c, capsize=3, ms=5, label=f"{label} (points, mean ± SD)")
        grid = np.logspace(np.log10(df.x.min()) - 0.3, np.log10(df.x.max()) + 0.3, 200)
        ic50 = fit["ic50"]; lo, hi = fit["ic50_ci95"]
        ax.plot(grid, fit["predict"](grid), color=c, lw=2,
                label=f"{label}: IC50 = {ic50:.3g} ({lo:.3g}–{hi:.3g}), Hill = {fit['hill']:.2f}")
        if show_ic50:
            half = fit["bottom"] + (fit["top"] - fit["bottom"]) / 2
            ax.plot([lo, hi], [half, half], color=c, lw=4, alpha=0.35)
            ax.axvline(ic50, color=c, ls=":", lw=1)
    ax.set_xscale("log")
    ax.set_xlabel(x_label); ax.set_ylabel(y_label); ax.set_title(title)
    ax.grid(alpha=0.25, which="both")
    ax.legend(fontsize=8, frameon=False)
    fig.tight_layout()
    return fig
