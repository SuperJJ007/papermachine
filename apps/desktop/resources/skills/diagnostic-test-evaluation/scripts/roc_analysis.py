"""ROC / AUC with DeLong confidence intervals and paired AUC comparison.

    from roc_analysis import roc_with_ci, delong_test
    res = roc_with_ci(y_true, score, png=os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "roc.png"))
    delong_test(y_true, score_a, score_b)
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import roc_curve, roc_auc_score
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _placements(y, s):
    y = np.asarray(y).astype(int); s = np.asarray(s, dtype=float)
    if y.shape != s.shape:
        raise ValueError("y and scores must have the same length")
    pos, neg = s[y == 1], s[y == 0]
    m, n = len(pos), len(neg)
    if m < 1 or n < 1:
        raise ValueError(f"DeLong requires at least one positive and one negative; n_pos={m}, n_neg={n}")
    all_s = np.concatenate([pos, neg])
    r_all = stats.rankdata(all_s); r_pos = stats.rankdata(pos); r_neg = stats.rankdata(neg)
    v10 = (r_all[:m] - r_pos) / n
    v01 = 1 - (r_all[m:] - r_neg) / m
    auc = (r_all[:m].sum() - m * (m + 1) / 2) / (m * n)
    return auc, v10, v01


def delong_ci(y, s, alpha=0.05):
    auc, v10, v01 = _placements(y, s)
    if len(v10) < 2 or len(v01) < 2:
        return auc, (float("nan"), float("nan")), float("nan"), "DEGENERATE_SAMPLE"
    var = np.var(v10, ddof=1) / len(v10) + np.var(v01, ddof=1) / len(v01)
    if not np.isfinite(var) or var <= 0:
        return auc, (float("nan"), float("nan")), float("nan"), "DEGENERATE_VARIANCE"
    z = stats.norm.ppf(1 - alpha / 2); se = np.sqrt(var)
    return auc, (max(0, auc - z * se), min(1, auc + z * se)), se, "OK"


def delong_test(y, s1, s2):
    s1 = np.asarray(s1, dtype=float); s2 = np.asarray(s2, dtype=float)
    a1, v10_1, v01_1 = _placements(y, s1); a2, v10_2, v01_2 = _placements(y, s2)
    n_pos, n_neg = len(v10_1), len(v01_1)
    if np.array_equal(s1, s2) or np.allclose(s1, s2):
        print(f"AUC1 = {a1:.3f}, AUC2 = {a2:.3f}: identical scores — DeLong comparison is degenerate (not a p-value).")
        return {"auc1": a1, "auc2": a2, "diff": 0.0, "ci": (float("nan"), float("nan")), "z": float("nan"), "p": float("nan"),
                "status": "DEGENERATE_IDENTICAL_SCORES", "n_pos": n_pos, "n_neg": n_neg}
    if n_pos < 2 or n_neg < 2:
        print(f"Too few positives ({n_pos}) or negatives ({n_neg}) for a paired DeLong test.")
        return {"auc1": a1, "auc2": a2, "diff": a1 - a2, "ci": (float("nan"), float("nan")), "z": float("nan"), "p": float("nan"),
                "status": "DEGENERATE_SAMPLE", "n_pos": n_pos, "n_neg": n_neg}
    S10 = np.cov(np.vstack([v10_1, v10_2])); S01 = np.cov(np.vstack([v01_1, v01_2]))
    S = S10 / n_pos + S01 / n_neg
    diff = a1 - a2; var = S[0, 0] + S[1, 1] - 2 * S[0, 1]
    if not np.isfinite(var) or var <= 0:
        print(f"AUC1 = {a1:.3f}, AUC2 = {a2:.3f}, difference = {diff:.3f}: DeLong variance is degenerate (var={var}).")
        return {"auc1": a1, "auc2": a2, "diff": diff, "ci": (float("nan"), float("nan")), "z": float("nan"), "p": float("nan"),
                "status": "DEGENERATE_VARIANCE", "n_pos": n_pos, "n_neg": n_neg}
    se = float(np.sqrt(var)); z = diff / se; p = 2 * (1 - stats.norm.cdf(abs(z)))
    ci = (diff - 1.96 * se, diff + 1.96 * se)
    print(f"AUC1 = {a1:.3f}, AUC2 = {a2:.3f}, difference = {diff:.3f} (95% CI {ci[0]:.3f} to {ci[1]:.3f}), DeLong z = {z:.2f}, p = {p:.4f}")
    return {"auc1": a1, "auc2": a2, "diff": diff, "ci": ci, "z": z, "p": p, "status": "OK", "n_pos": n_pos, "n_neg": n_neg}


def roc_with_ci(y_true, score, png=None, label="Index test", target_sens=0.95, target_spec=0.95):
    auc, ci, se, status = delong_ci(y_true, score)
    if status != "OK":
        print(f"AUC = {auc:.3f}; DeLong CI not estimable ({status})")
    fpr, tpr, thr = roc_curve(y_true, score)
    youden = tpr - fpr; j = int(np.argmax(youden))
    print(f"AUC = {auc:.3f} (DeLong 95% CI {ci[0]:.3f}–{ci[1]:.3f}); n_pos = {int(np.sum(y_true))}, n_neg = {int(len(y_true) - np.sum(y_true))}")
    print(f"Youden cut-off = {thr[j]:.4g}: Se = {tpr[j]:.3f}, Sp = {1 - fpr[j]:.3f}")
    tbl = pd.DataFrame({"threshold": thr, "sensitivity": tpr, "specificity": 1 - fpr, "youden": youden})
    ro = tbl[tbl.sensitivity >= target_sens].sort_values("specificity", ascending=False).head(1)
    ri = tbl[tbl.specificity >= target_spec].sort_values("sensitivity", ascending=False).head(1)
    if len(ro): print(f"Rule-out cut-off (Se≥{target_sens}): {ro.threshold.iloc[0]:.4g} → Sp = {ro.specificity.iloc[0]:.3f}")
    if len(ri): print(f"Rule-in  cut-off (Sp≥{target_spec}): {ri.threshold.iloc[0]:.4g} → Se = {ri.sensitivity.iloc[0]:.3f}")
    if png:
        fig, ax = plt.subplots(figsize=(6, 6))
        ax.plot(fpr, tpr, lw=2, label=f"{label}: AUC {auc:.3f} ({ci[0]:.3f}–{ci[1]:.3f})")
        ax.plot([0, 1], [0, 1], "--", color="grey")
        ax.scatter(fpr[j], tpr[j], color="red", zorder=5, label=f"Youden cut-off {thr[j]:.3g}")
        ax.set_xlabel("1 − Specificity"); ax.set_ylabel("Sensitivity"); ax.legend(loc="lower right")
        ax.set_title("ROC curve")
        fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)
    return {"auc": auc, "ci": ci, "youden_threshold": thr[j], "table": tbl}
