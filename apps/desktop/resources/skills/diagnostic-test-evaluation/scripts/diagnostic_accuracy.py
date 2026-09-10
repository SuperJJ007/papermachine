"""Diagnostic accuracy from a 2x2 table with 95% CIs.

    from diagnostic_accuracy import accuracy_from_counts
    accuracy_from_counts(tp=85, fp=20, fn=15, tn=180, target_prevalence=0.05)
"""
from __future__ import annotations
import math
from scipy import stats


def wilson(x, n, z=1.959964):
    if n == 0:
        return (float("nan"), float("nan"))
    p = x / n
    denom = 1 + z * z / n
    c = (p + z * z / (2 * n)) / denom
    d = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, c - d), min(1.0, c + d))


def _log_ci(est, se, z=1.959964):
    return (math.exp(math.log(est) - z * se), math.exp(math.log(est) + z * se))


def _bayes_ppv(se: float, sp: float, prev: float) -> float:
    """Direct Bayes PPV; avoids inf/inf when LR+ is undefined (specificity = 1)."""
    if not (0 <= prev <= 1):
        return float("nan")
    num = se * prev
    den = se * prev + (1.0 - sp) * (1.0 - prev)
    if den == 0:
        return 1.0 if num > 0 else float("nan")
    return num / den


def _bayes_npv(se: float, sp: float, prev: float) -> float:
    num = sp * (1.0 - prev)
    den = sp * (1.0 - prev) + (1.0 - se) * prev
    if den == 0:
        return 1.0 if num > 0 else float("nan")
    return num / den


def accuracy_from_counts(tp: int, fp: int, fn: int, tn: int, target_prevalence: float | None = None) -> dict:
    for name, val in (("tp", tp), ("fp", fp), ("fn", fn), ("tn", tn)):
        if val < 0 or int(val) != val:
            raise ValueError(f"{name} must be a non-negative integer")
    n_pos, n_neg, n = tp + fn, tn + fp, tp + fp + fn + tn
    if n == 0:
        raise ValueError("All counts are zero")
    se = tp / n_pos if n_pos else float("nan")
    sp = tn / n_neg if n_neg else float("nan")
    prev = n_pos / n
    ppv = tp / (tp + fp) if (tp + fp) else float("nan")
    npv = tn / (tn + fn) if (tn + fn) else float("nan")
    lr_pos = se / (1 - sp) if n_pos and n_neg and sp < 1 else (float("inf") if n_pos and n_neg and se > 0 else float("nan"))
    lr_neg = (1 - se) / sp if n_pos and n_neg and sp > 0 else (float("inf") if n_pos and n_neg and se < 1 else float("nan"))
    se_lrp = math.sqrt((1 - se) / tp + sp / fp) if fp and tp else float("nan")
    se_lrn = math.sqrt(se / fn + (1 - sp) / tn) if fn and tn else float("nan")
    dor = (tp * tn) / (fp * fn) if fp and fn else float("inf")
    out = {
        "prevalence": prev,
        "sensitivity": (se, wilson(tp, n_pos)), "specificity": (sp, wilson(tn, n_neg)),
        "ppv": (ppv, wilson(tp, tp + fp)), "npv": (npv, wilson(tn, tn + fn)),
        "lr_pos": (lr_pos, _log_ci(lr_pos, se_lrp) if math.isfinite(se_lrp) and math.isfinite(lr_pos) and lr_pos > 0 else (float("nan"), float("nan"))),
        "lr_neg": (lr_neg, _log_ci(lr_neg, se_lrn) if math.isfinite(se_lrn) and math.isfinite(lr_neg) and lr_neg > 0 else (float("nan"), float("nan"))),
        "dor": dor, "accuracy": ((tp + tn) / n, wilson(tp + tn, n)),
    }
    print(f"Prevalence in sample: {prev:.3f}  (n={n}, diseased={n_pos})")
    for k in ("sensitivity", "specificity", "ppv", "npv", "accuracy"):
        v, (lo, hi) = out[k]
        print(f"{k:12s} {v:.3f} (95% CI {lo:.3f}–{hi:.3f})" if math.isfinite(v) else f"{k:12s} not estimable")
    print(f"LR+ {lr_pos:.2f}; LR− {lr_neg:.2f}; DOR {dor:.1f}")
    if target_prevalence is not None:
        if not (0 <= target_prevalence <= 1):
            raise ValueError("target_prevalence must lie in [0, 1]")
        ppv_t = _bayes_ppv(se, sp, target_prevalence)
        npv_t = _bayes_npv(se, sp, target_prevalence)
        out["ppv_at_target"], out["npv_at_target"] = ppv_t, npv_t
        out["ppv_at_target_status"] = "OK" if math.isfinite(ppv_t) else "NOT_ESTIMABLE"
        print(f"At target prevalence {target_prevalence:.3f}: PPV = {ppv_t:.3f}, NPV = {npv_t:.3f}" if math.isfinite(ppv_t) else
              f"At target prevalence {target_prevalence:.3f}: PPV/NPV not estimable")
    _, p_fisher = stats.fisher_exact([[tp, fp], [fn, tn]])
    out["p_fisher"] = p_fisher
    return out
