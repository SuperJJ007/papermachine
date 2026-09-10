"""Restricted mean survival time (RMST) difference between two groups.

    from rmst import rmst_difference, km_step_integral
    rmst_difference(df, time="pfs", event="prog", group="arm", tau=24)
"""
from __future__ import annotations
import numpy as np
from scipy import stats


def km_step_integral(times, surv, start: float, tau: float) -> float:
    """Integral of a right-constant KM step function on [start, tau].

    S(t_i) holds from t_i until the next jump (or tau). Linear/trapezoidal
    interpolation is not used: KM is a step function (Royston & Parmar 2013;
    Klein & Moeschberger).
    """
    if tau <= start:
        return 0.0
    t = np.asarray(times, dtype=float)
    s = np.asarray(surv, dtype=float)
    if t.size == 0:
        return 0.0
    order = np.argsort(t)
    t, s = t[order], s[order]
    area = 0.0
    for i in range(len(t)):
        left = t[i]
        right = t[i + 1] if i + 1 < len(t) else tau
        a = max(left, start)
        b = min(right, tau)
        if b > a:
            area += float(s[i]) * (b - a)
        if right >= tau:
            break
    if t[-1] < start:
        return float(s[-1]) * (tau - start)
    return area


def greenwood_rmst_variance(event_times, n_at_risk, n_events, sf_times, sf_surv, tau: float) -> float:
    """Greenwood-type RMST variance using step-function area after each event time."""
    var = 0.0
    for t, n, d in zip(event_times, n_at_risk, n_events):
        if t > tau or d == 0 or n <= d or n <= 0:
            continue
        area = km_step_integral(sf_times, sf_surv, t, tau)
        var += (area ** 2) * d / (n * (n - d))
    return float(var)


def _rmst_var(kmf, tau):
    """Greenwood-type variance of RMST (Royston & Parmar 2013) on the KM step function."""
    sf = kmf.survival_function_.loc[:tau]
    times = sf.index.values.astype(float)
    s = sf.iloc[:, 0].values.astype(float)
    ev = kmf.event_table.loc[:tau]
    return greenwood_rmst_variance(
        ev.index.values.astype(float),
        ev["at_risk"].values.astype(float),
        ev["observed"].values.astype(float),
        times,
        s,
        tau,
    )


def rmst_difference(df, time, event, group, tau, alpha=0.05):
    """Point estimate uses lifelines RMST; variance is the Greenwood step-function formula.

    Cross-check tau, n, events and the difference against a reference implementation
    (e.g. R survRM2::rmst2) before treating the CI as publication-ready.
    """
    from lifelines import KaplanMeierFitter
    from lifelines.utils import restricted_mean_survival_time

    groups = list(df[group].dropna().unique())
    assert len(groups) == 2, "two groups required"
    out = {}
    for g in groups:
        sub = df[df[group] == g]
        kmf = KaplanMeierFitter().fit(sub[time], sub[event])
        r = restricted_mean_survival_time(kmf, t=tau)
        out[g] = (float(r), _rmst_var(kmf, tau))
        print(f"{g}: RMST({tau}) = {r:.2f}")
    (r1, v1), (r0, v0) = out[groups[0]], out[groups[1]]
    diff = r1 - r0
    se = float(np.sqrt(v1 + v0))
    z = stats.norm.ppf(1 - alpha / 2)
    if not np.isfinite(se) or se <= 0:
        print(f"RMST difference ({groups[0]} − {groups[1]}) = {diff:.2f}; Greenwood SE not estimable")
        return {"diff": diff, "ci": (float("nan"), float("nan")), "p": float("nan"), "tau": tau, "status": "VARIANCE_NOT_ESTIMABLE",
                "variance_method": "greenwood_step_function", "reference": "cross-check survRM2 before publication"}
    p = 2 * (1 - stats.norm.cdf(abs(diff / se)))
    print(f"RMST difference ({groups[0]} − {groups[1]}) = {diff:.2f} (95% CI {diff - z*se:.2f} to {diff + z*se:.2f}), p = {p:.4f} [Greenwood step-function variance; confirm with survRM2]")
    return {"diff": diff, "ci": (diff - z * se, diff + z * se), "p": p, "tau": tau, "status": "OK",
            "variance_method": "greenwood_step_function", "reference": "cross-check survRM2 before publication"}
