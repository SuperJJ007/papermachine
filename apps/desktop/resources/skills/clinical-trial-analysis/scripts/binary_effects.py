"""Risk difference, relative risk, odds ratio and NNT with 95% CIs for a 2x2 table.

    from binary_effects import binary_effects
    binary_effects(events_tx=45, n_tx=200, events_ctl=70, n_ctl=205)
"""
from __future__ import annotations
import math
from scipy import stats


def _newcombe_rd(e1, n1, e0, n0, z=1.959964):
    def wilson(e, n):
        p = e / n
        d = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
        c = (p + z * z / (2 * n)) / (1 + z * z / n)
        return c - d / (1 + z * z / n), c + d / (1 + z * z / n)
    l1, u1 = wilson(e1, n1); l0, u0 = wilson(e0, n0)
    p1, p0 = e1 / n1, e0 / n0
    rd = p1 - p0
    return rd, rd - math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2), rd + math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2)


def binary_effects(events_tx: int, n_tx: int, events_ctl: int, n_ctl: int, alpha: float = 0.05, zero_cells: str = "reject") -> dict:
    """RD uses Newcombe; RR/OR use Wald on the log scale.

    Zero cells: default `reject` (RD may still be returned with RR/OR marked undefined).
    Pass `zero_cells='haldane'` to apply the Haldane–Anscombe 0.5 correction to RR/OR only;
    declare that correction in the SAP. Silent continuity correction is not used.
    Cross-check sparse tables with exact/unconditional methods before publication.
    """
    for label, e, n in (("tx", events_tx, n_tx), ("ctl", events_ctl, n_ctl)):
        if n <= 0 or e < 0 or e > n:
            raise ValueError(f"Invalid counts for {label}: events={e}, n={n}")
    if zero_cells not in {"reject", "haldane"}:
        raise ValueError("zero_cells must be 'reject' or 'haldane'")
    z = stats.norm.ppf(1 - alpha / 2)
    p1, p0 = events_tx / n_tx, events_ctl / n_ctl
    rd, rd_l, rd_u = _newcombe_rd(events_tx, n_tx, events_ctl, n_ctl, z)
    a, b, c, d = events_tx, n_tx - events_tx, events_ctl, n_ctl - events_ctl
    zero = min(a, b, c, d) == 0
    nnt = 1 / abs(rd) if rd != 0 else float("inf")
    nnt_ci = tuple(sorted([1 / abs(x) if x != 0 else float("inf") for x in (rd_l, rd_u)])) if rd_l * rd_u > 0 else ("NNTB ∞", "NNTH ∞ (CI crosses 0)")
    if (a + c == 0) or (b + d == 0) or (a + b == 0) or (c + d == 0):
        p_chi = float("nan")
    else:
        try:
            _, p_chi, _, _ = stats.chi2_contingency([[a, b], [c, d]], correction=False)
        except (ValueError, ZeroDivisionError):
            p_chi = float("nan")
    out = {
        "risk_tx": p1, "risk_ctl": p0,
        "risk_difference": rd, "rd_ci": (rd_l, rd_u),
        "nnt": nnt, "nnt_ci": nnt_ci, "p_chi2": p_chi, "zero_cells": zero,
        "zero_cell_method": "none" if not zero else zero_cells,
    }
    if zero and zero_cells == "reject":
        out.update({
            "relative_risk": float("nan"), "rr_ci": (float("nan"), float("nan")),
            "odds_ratio": float("nan"), "or_ci": (float("nan"), float("nan")),
            "status": "RD_ONLY_ZERO_CELLS",
        })
        print(f"Risk {p1:.3f} vs {p0:.3f}; RD = {rd:.3f} (95% CI {rd_l:.3f} to {rd_u:.3f}); "
              f"RR/OR undefined (zero cell). Pass zero_cells='haldane' to apply a declared 0.5 correction, or use an exact method. p = {p_chi:.4f}")
        return out
    aa, bb, cc, dd = (a + 0.5, b + 0.5, c + 0.5, d + 0.5) if zero else (a, b, c, d)
    rr = (aa / (aa + bb)) / (cc / (cc + dd))
    se_rr = math.sqrt(1 / aa - 1 / (aa + bb) + 1 / cc - 1 / (cc + dd))
    orr = (aa * dd) / (bb * cc)
    se_or = math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd)
    out.update({
        "relative_risk": rr, "rr_ci": (math.exp(math.log(rr) - z * se_rr), math.exp(math.log(rr) + z * se_rr)),
        "odds_ratio": orr, "or_ci": (math.exp(math.log(orr) - z * se_or), math.exp(math.log(orr) + z * se_or)),
        "status": "HALDANE_ANSCOMBE" if zero else "OK",
    })
    extra = " [Haldane–Anscombe 0.5 on RR/OR]" if zero else ""
    print(f"Risk {p1:.3f} vs {p0:.3f}; RD = {rd:.3f} (95% CI {rd_l:.3f} to {rd_u:.3f}); "
          f"RR = {rr:.2f} ({out['rr_ci'][0]:.2f}–{out['rr_ci'][1]:.2f}); "
          f"OR = {orr:.2f} ({out['or_ci'][0]:.2f}–{out['or_ci'][1]:.2f}); NNT = {nnt:.1f}; p = {p_chi:.4f}{extra}")
    return out
