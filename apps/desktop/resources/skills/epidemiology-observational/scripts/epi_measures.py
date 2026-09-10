"""Epidemiological effect measures.

    from epi_measures import two_by_two, incidence_rate, mantel_haenszel, additive_interaction, e_value, direct_standardize
"""
from __future__ import annotations
import math
import numpy as np
import pandas as pd
from scipy import stats

Z = 1.959964


def two_by_two(a, b, c, d, design="cohort"):
    """a = exposed cases, b = exposed non-cases, c = unexposed cases, d = unexposed non-cases."""
    out = {}
    if min(a, b, c, d) == 0:
        out["OR"] = (float("nan"), float("nan"), float("nan"))
        if design in ("cohort", "cross-sectional"):
            r1 = a / (a + b) if (a + b) > 0 else float("nan")
            r0 = c / (c + d) if (c + d) > 0 else float("nan")
            rd = r1 - r0
            out["RD"] = (rd, float("nan"), float("nan"))
            out["RR" if design == "cohort" else "PR"] = (float("nan"), float("nan"), float("nan"))
            out["AF_exposed"] = float("nan")
            out["PAF"] = float("nan")
    else:
        orr = (a * d) / (b * c); se_or = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
        out["OR"] = (orr, math.exp(math.log(orr) - Z * se_or), math.exp(math.log(orr) + Z * se_or))
        if design in ("cohort", "cross-sectional"):
            r1, r0 = a / (a + b), c / (c + d)
            rr = r1 / r0; se_rr = math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
            out["RR" if design == "cohort" else "PR"] = (rr, math.exp(math.log(rr) - Z * se_rr), math.exp(math.log(rr) + Z * se_rr))
            rd = r1 - r0; se_rd = math.sqrt(r1 * (1 - r1) / (a + b) + r0 * (1 - r0) / (c + d))
            out["RD"] = (rd, rd - Z * se_rd, rd + Z * se_rd)
            out["AF_exposed"] = (rr - 1) / rr
            pe = (a + b) / (a + b + c + d)
            out["PAF"] = pe * (rr - 1) / (pe * (rr - 1) + 1)
    if (a + c == 0) or (b + d == 0) or (a + b == 0) or (c + d == 0):
        p = float("nan")
    else:
        try:
            _, p = stats.chi2_contingency([[a, b], [c, d]], correction=False)[:2]
        except (ValueError, ZeroDivisionError):
            p = float("nan")
    out["p_chi2"] = p
    for k, v in out.items():
        print(f"{k}: " + (f"{v[0]:.3f} (95% CI {v[1]:.3f}–{v[2]:.3f})" if isinstance(v, tuple) else f"{v:.4f}"))
    return out


def incidence_rate(events, person_time, per=1000):
    rate = events / person_time
    lo, hi = stats.chi2.ppf(0.025, 2 * events) / 2 / person_time, stats.chi2.ppf(0.975, 2 * (events + 1)) / 2 / person_time
    print(f"Incidence rate: {rate*per:.2f} per {per} person-time (exact 95% CI {lo*per:.2f}–{hi*per:.2f}); events = {events}, PT = {person_time:.1f}")
    return rate, (lo, hi)


def rate_ratio(e1, pt1, e0, pt0):
    irr = (e1 / pt1) / (e0 / pt0); se = math.sqrt(1 / e1 + 1 / e0)
    ci = (math.exp(math.log(irr) - Z * se), math.exp(math.log(irr) + Z * se))
    print(f"Rate ratio = {irr:.3f} (95% CI {ci[0]:.3f}–{ci[1]:.3f})")
    return irr, ci


def mantel_haenszel(tables, measure="OR"):
    """tables: list of (a,b,c,d) per stratum."""
    num = den = 0.0; strata = []
    for i, (a, b, c, d) in enumerate(tables):
        n = a + b + c + d
        if measure == "OR":
            num += a * d / n; den += b * c / n; est = (a * d) / (b * c) if b * c else float("nan")
        else:
            num += a * (c + d) / n; den += c * (a + b) / n; est = (a / (a + b)) / (c / (c + d))
        strata.append(est); print(f"Stratum {i+1}: {measure} = {est:.3f}")
    mh = num / den
    # Robins-Breslow-Greenland variance for OR
    if measure == "OR":
        P = Q = R = S = PR = PS_QR = QS = 0.0
        for a, b, c, d in tables:
            n = a + b + c + d; p, q, r, s = (a + d) / n, (b + c) / n, a * d / n, b * c / n
            PR += p * r; PS_QR += p * s + q * r; QS += q * s; R += r; S += s
        var = PR / (2 * R * R) + PS_QR / (2 * R * S) + QS / (2 * S * S)
    else:
        var_num = sum(((a + b) * (c + d) * (a + c) - a * c * (a + b + c + d)) / (a + b + c + d) ** 2 for a, b, c, d in tables)
        var = var_num / (num * den)
    ci = (math.exp(math.log(mh) - Z * math.sqrt(var)), math.exp(math.log(mh) + Z * math.sqrt(var)))
    # Breslow-Day homogeneity (OR) via chi-square of log estimates (Woolf approximation)
    logs = np.log([s for s in strata if np.isfinite(s) and s > 0])
    ws = np.array([1 / (1 / a + 1 / b + 1 / c + 1 / d) for a, b, c, d in tables])[:len(logs)]
    pooled = np.sum(ws * logs) / np.sum(ws); chi = np.sum(ws * (logs - pooled) ** 2)
    p_hom = stats.chi2.sf(chi, len(logs) - 1)
    print(f"Mantel-Haenszel {measure} = {mh:.3f} (95% CI {ci[0]:.3f}–{ci[1]:.3f}); Woolf homogeneity p = {p_hom:.4f}"
          + ("  ⚠ heterogeneous strata — report separately (effect modification)" if p_hom < 0.05 else ""))
    return {"mh": mh, "ci": ci, "strata": strata, "p_homogeneity": p_hom}


def additive_interaction(rr11, rr10, rr01, cov=None, se11=None, se10=None, se01=None):
    """RERI, attributable proportion, synergy index from RRs (or ORs) with 00 as reference."""
    reri = rr11 - rr10 - rr01 + 1
    ap = reri / rr11
    s = (rr11 - 1) / ((rr10 - 1) + (rr01 - 1)) if (rr10 - 1) + (rr01 - 1) != 0 else float("nan")
    print(f"RERI = {reri:.3f}, AP = {ap:.3f}, S = {s:.3f}  (RERI > 0 → positive additive interaction)")
    if se11 and se10 and se01:  # delta-method CI ignoring covariances
        var = (rr11 * se11) ** 2 + (rr10 * se10) ** 2 + (rr01 * se01) ** 2
        print(f"RERI 95% CI ≈ {reri - Z*math.sqrt(var):.3f} to {reri + Z*math.sqrt(var):.3f} (delta method, covariances ignored)")
    return {"RERI": reri, "AP": ap, "S": s}


def e_value(estimate, ci_bound=None, rare_outcome=True):
    """VanderWeele & Ding 2017. For OR/HR with common outcome, first convert: RR ≈ sqrt(OR)."""
    def ev(rr):
        rr = rr if rr >= 1 else 1 / rr
        return rr + math.sqrt(rr * (rr - 1))
    e = ev(estimate)
    msg = f"E-value for point estimate {estimate:.2f}: {e:.2f}"
    e_ci = None
    if ci_bound is not None:
        crosses = (estimate >= 1 and ci_bound <= 1) or (estimate < 1 and ci_bound >= 1)
        e_ci = 1.0 if crosses else ev(ci_bound)
        msg += f"; for CI bound {ci_bound:.2f}: {e_ci:.2f}"
    print(msg + " — minimum strength of association an unmeasured confounder would need with both exposure and outcome to explain away the result.")
    return e, e_ci


def direct_standardize(df, rate_col, pop_col, std_pop_col, per=100000):
    """df rows = age strata; rate_col = stratum rate (events/pop), std_pop_col = standard population."""
    w = df[std_pop_col] / df[std_pop_col].sum()
    asr = float((df[rate_col] * w).sum())
    var = float(((w ** 2) * df[rate_col] / df[pop_col]).sum())
    ci = (asr - Z * math.sqrt(var), asr + Z * math.sqrt(var))
    print(f"Age-standardized rate: {asr*per:.2f} per {per} (95% CI {ci[0]*per:.2f}–{ci[1]*per:.2f})")
    return asr, ci
