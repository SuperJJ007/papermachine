"""Sample size, bootstrap internal validation and calibration for prediction models.

    from model_validation import riley_sample_size, bootstrap_validate, calibration_plot
    riley_sample_size(n_params=10, prevalence=0.15, r2_cs=0.15)
    res = bootstrap_validate(X, y, B=200)
    calibration_plot(y, res["pred"], png=...)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss
import statsmodels.api as sm
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def max_cox_snell_r2(prevalence: float) -> float:
    """Maximum Cox-Snell R² for a binary outcome (Riley et al. Stat Med 2019)."""
    p = prevalence
    return 1.0 - (p ** p * (1.0 - p) ** (1.0 - p)) ** 2


def _riley_n_for_shrinkage(n_params: int, r2_cs: float, target_shrinkage: float) -> float:
    if not (0 < r2_cs < target_shrinkage < 1):
        raise ValueError(f"Need 0 < R²_CS < shrinkage < 1; got R²_CS={r2_cs}, shrinkage={target_shrinkage}")
    return n_params / ((target_shrinkage - 1.0) * np.log(1.0 - r2_cs / target_shrinkage))


def riley_sample_size(n_params: int, prevalence: float, r2_cs: float | None = None, shrinkage: float = 0.9) -> dict:
    """Riley et al. 2019 three-criterion minimum n for binary-outcome model development.

    Matches pmsampsize (Ensor / Riley) criteria:
      1. expected shrinkage of predictor effects (default S=0.9)
      2. absolute difference ≤0.05 between apparent and adjusted Nagelkerke R²
      3. intercept / overall risk precise to ±0.05 (95% CI half-width)
    Call official `pmsampsize` in R for survival/continuous outcomes and for the published implementation.
    """
    if n_params < 1:
        raise ValueError("n_params must be a positive integer")
    if not (0 < prevalence < 1):
        raise ValueError("prevalence must lie in (0, 1)")
    if not (0 < shrinkage < 1):
        raise ValueError("shrinkage must lie in (0, 1)")
    max_r2 = max_cox_snell_r2(prevalence)
    r2 = float(r2_cs) if r2_cs is not None else 0.15 * max_r2
    if r2 <= 0 or r2 >= max_r2:
        raise ValueError(f"R²_CS must lie in (0, max R²_CS={max_r2:.4f})")
    n1 = _riley_n_for_shrinkage(n_params, r2, shrinkage)
    s2 = r2 / (r2 + 0.05 * max_r2)
    n2 = _riley_n_for_shrinkage(n_params, r2, s2)
    n3 = (1.96 / 0.05) ** 2 * prevalence * (1.0 - prevalence)
    n1c, n2c, n3c = int(np.ceil(n1)), int(np.ceil(n2)), int(np.ceil(n3))
    n = max(n1c, n2c, n3c)
    events = int(np.ceil(n * prevalence))
    out = {
        "n": n, "n1_shrinkage": n1c, "n2_nagelkerke": n2c, "n3_intercept": n3c,
        "events": events, "epv": n * prevalence / n_params, "r2_cs": r2, "max_r2_cs": max_r2,
        "shrinkage_criterion2": float(s2), "implementation": "Riley 2019 three criteria (binary); cross-check pmsampsize",
    }
    print(
        f"Minimum n = {n} (crit1 shrinkage S={shrinkage}: {n1c}; "
        f"crit2 ΔNagelkerke R²≤0.05, S*={s2:.3f}: {n2c}; "
        f"crit3 intercept ±0.05: {n3c}); events ≈ {events}; EPV ≈ {out['epv']:.1f}; "
        f"max R²_CS = {max_r2:.3f}, assumed R²_CS = {r2:.3f}"
    )
    return out


def _fit(X, y, C):
    return LogisticRegression(penalty="l2", C=C, max_iter=5000, solver="lbfgs").fit(X, y)


def calibration_slope_intercept(y, p):
    lp = np.log(p / (1 - p))
    slope = sm.Logit(y, sm.add_constant(lp)).fit(disp=0).params[1]
    citl = sm.Logit(y, np.ones_like(lp), offset=lp).fit(disp=0).params[0]
    return float(slope), float(citl)


def bootstrap_validate(X, y, B=200, C=1.0, seed=42, min_successful: int = 50):
    """Harrell's bootstrap optimism correction for AUC, calibration slope and Brier.

    Fits a resample only after both classes are present. Separation or singular
    calibration fits are counted as failed draws. Corrected metrics are returned
    only when enough draws succeed; otherwise status is NOT_ESTIMABLE.
    """
    rng = np.random.default_rng(seed); X = np.asarray(X, float); y = np.asarray(y).astype(int); n = len(y)
    if len(np.unique(y)) < 2:
        raise ValueError("Original sample has a single class; bootstrap validation is not estimable")
    model = _fit(X, y, C); p_app = model.predict_proba(X)[:, 1]
    auc_app = roc_auc_score(y, p_app); slope_app, citl_app = calibration_slope_intercept(y, p_app); brier_app = brier_score_loss(y, p_app)
    opt = []
    failed = 0
    for _ in range(B):
        idx = rng.integers(0, n, n)
        if len(np.unique(y[idx])) < 2:
            failed += 1
            continue
        try:
            m = _fit(X[idx], y[idx], C)
            pb, po = m.predict_proba(X[idx])[:, 1], m.predict_proba(X)[:, 1]
            if np.min(pb) <= 0 or np.max(pb) >= 1 or np.min(po) <= 0 or np.max(po) >= 1:
                failed += 1
                continue
            sb, _ = calibration_slope_intercept(y[idx], pb); so, _ = calibration_slope_intercept(y, po)
            opt.append([roc_auc_score(y[idx], pb) - roc_auc_score(y, po), sb - so, brier_score_loss(y[idx], pb) - brier_score_loss(y, po)])
        except (np.linalg.LinAlgError, ValueError):
            failed += 1
    res = {
        "auc_apparent": auc_app, "slope_apparent": slope_app, "citl": citl_app, "brier_apparent": brier_app,
        "pred": p_app, "model": model, "B_requested": B, "B_successful": len(opt), "B_failed": failed,
    }
    if len(opt) < min_successful:
        res["status"] = "NOT_ESTIMABLE"
        print(f"Bootstrap not estimable: {len(opt)}/{B} successful draws (need ≥{min_successful}); failed={failed}. Apparent AUC {auc_app:.3f} is not optimism-corrected.")
        return res
    o = np.mean(opt, axis=0)
    res.update({
        "status": "OK", "auc_corrected": auc_app - o[0], "slope_corrected": slope_app - o[1],
        "brier_corrected": brier_app - o[2], "optimism_auc": float(o[0]),
    })
    print(f"Apparent AUC {auc_app:.3f} → optimism-corrected {res['auc_corrected']:.3f} (optimism {o[0]:.3f}, B successful = {len(opt)}, failed = {failed})")
    print(f"Calibration slope {slope_app:.3f} → corrected {res['slope_corrected']:.3f} (shrinkage factor to apply to coefficients); CITL = {citl_app:.3f}")
    print(f"Brier {brier_app:.4f} → corrected {res['brier_corrected']:.4f}")
    if res["slope_corrected"] < 0.85:
        print("⚠ Substantial overfitting: multiply coefficients by the corrected slope or increase penalization.")
    return res


def calibration_plot(y, p, png, bins=10, title="Calibration"):
    y = np.asarray(y).astype(int); p = np.asarray(p, float)
    df = pd.DataFrame({"y": y, "p": p}); df["bin"] = pd.qcut(df.p, bins, duplicates="drop")
    g = df.groupby("bin", observed=True).agg(obs=("y", "mean"), pred=("p", "mean"), n=("y", "size")).reset_index()
    g["se"] = np.sqrt(g.obs * (1 - g.obs) / g.n)
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], "--", color="grey", label="Perfect")
    ax.errorbar(g.pred, g.obs, yerr=1.96 * g.se, fmt="o", color="black", capsize=3, label="Deciles")
    order = np.argsort(p); from statsmodels.nonparametric.smoothers_lowess import lowess
    lw = lowess(y[order], p[order], frac=0.6, return_sorted=True); ax.plot(lw[:, 0], lw[:, 1], color="steelblue", label="Loess")
    slope, citl = calibration_slope_intercept(y, p)
    oe = y.mean() / p.mean()
    ax.set_xlabel("Predicted probability"); ax.set_ylabel("Observed proportion"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_title(f"{title}: slope {slope:.2f}, CITL {citl:.2f}, O:E {oe:.2f}"); ax.legend()
    ax2 = ax.inset_axes([0.55, 0.08, 0.4, 0.15]); ax2.hist(p, bins=30, color="lightgrey"); ax2.set_yticks([]); ax2.set_title("Predicted risk", fontsize=7)
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
    print(f"Calibration slope {slope:.3f}, calibration-in-the-large {citl:.3f}, O:E {oe:.3f}")
    return g
