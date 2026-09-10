"""Baseline characteristics table (Table 1) with standardized mean differences.

Usage inside run_python:
    from table_one import table_one
    t1 = table_one(df, group="arm", continuous=["age","bmi"], categorical=["sex","stage"],
                   nonnormal=["crp"], out_dir=os.environ["SCIENCE_ARTIFACT_DIR"])
Writes table_one.csv and table_one.md and returns the DataFrame.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd
from scipy import stats


def smd_continuous(a: pd.Series, b: pd.Series) -> float:
    a, b = a.dropna(), b.dropna()
    if len(a) < 2 or len(b) < 2:
        return float('nan')
    if not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError('SMD requires finite observations')
    pooled = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
    difference = float(a.mean() - b.mean())
    if pooled == 0:
        return 0.0 if difference == 0 else float(np.copysign(np.inf, difference))
    return difference / pooled


def smd_categorical(a: pd.Series, b: pd.Series) -> float:
    """Multi-category SMD (Yang & Dalton 2012)."""
    a, b = a.dropna(), b.dropna()
    if len(a) == 0 or len(b) == 0:
        return float('nan')
    levels = sorted(set(a) | set(b), key=str)
    if len(levels) < 2:
        return 0.0
    pa = np.array([(a == l).mean() for l in levels[1:]])
    pb = np.array([(b == l).mean() for l in levels[1:]])
    S = (np.diag(pa * (1 - pa)) + np.diag(pb * (1 - pb))) / 2
    for i in range(len(pa)):
        for j in range(len(pa)):
            if i != j:
                S[i, j] = -(pa[i] * pa[j] + pb[i] * pb[j]) / 2
    diff = pa - pb
    try:
        inverse = np.linalg.pinv(S)
        # A difference outside the covariance's range is complete separation,
        # not zero imbalance. A pseudoinverse alone silently discards it.
        if not np.allclose(S @ inverse @ diff, diff, atol=1e-12, rtol=1e-10):
            return float('inf')
        return float(np.sqrt(max(0.0, diff @ inverse @ diff)))
    except np.linalg.LinAlgError:
        return float("nan")


def table_one(df: pd.DataFrame, group: str, continuous: list[str], categorical: list[str],
              nonnormal: list[str] | None = None, out_dir: str | None = None,
              decimals: int = 1) -> pd.DataFrame:
    nonnormal = set(nonnormal or [])
    groups = list(pd.unique(df[group].dropna()))
    if len(groups) != 2:
        raise ValueError(f"table_one expects exactly 2 groups, got {groups}")
    g1, g2 = groups
    rows = []
    n_row = {"Variable": "n", g1: int((df[group] == g1).sum()), g2: int((df[group] == g2).sum()), "SMD": ""}
    rows.append(n_row)
    for v in continuous:
        a, b = df.loc[df[group] == g1, v], df.loc[df[group] == g2, v]
        if v in nonnormal:
            fmt = lambda s: f"{s.median():.{decimals}f} [{s.quantile(.25):.{decimals}f}, {s.quantile(.75):.{decimals}f}]"
            label = f"{v}, median [IQR]"
        else:
            fmt = lambda s: f"{s.mean():.{decimals}f} ({s.std(ddof=1):.{decimals}f})"
            label = f"{v}, mean (SD)"
        rows.append({"Variable": label, g1: fmt(a), g2: fmt(b), "SMD": f"{abs(smd_continuous(a, b)):.3f}"})
        miss = df[v].isna().sum()
        if miss:
            rows.append({"Variable": f"  missing", g1: int(a.isna().sum()), g2: int(b.isna().sum()), "SMD": ""})
    for v in categorical:
        a, b = df.loc[df[group] == g1, v], df.loc[df[group] == g2, v]
        rows.append({"Variable": f"{v}, n (%)", g1: "", g2: "", "SMD": f"{smd_categorical(a, b):.3f}"})
        for lvl in sorted(df[v].dropna().unique(), key=str):
            ca, cb = int((a == lvl).sum()), int((b == lvl).sum())
            rows.append({"Variable": f"  {lvl}", g1: f"{ca} ({100*ca/max(len(a.dropna()),1):.{decimals}f})",
                         g2: f"{cb} ({100*cb/max(len(b.dropna()),1):.{decimals}f})", "SMD": ""})
        if a.isna().any() or b.isna().any():
            rows.append({"Variable": f"  {v}: missing", g1: int(a.isna().sum()), g2: int(b.isna().sum()), "SMD": ""})
    out = pd.DataFrame(rows)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        out.to_csv(os.path.join(out_dir, "table_one.csv"), index=False)
        with open(os.path.join(out_dir, "table_one.md"), "w", encoding="utf-8") as fh:
            fh.write(out.to_markdown(index=False))
            fh.write('\n\nSMD uses non-missing observations. inf = complete separation; nan = insufficient data. Neither is evidence of balance.\n')
    print('SMD: inf means complete separation; nan means insufficient data. Neither means balanced.')
    flagged = out[(out["SMD"] != "") & (pd.to_numeric(out["SMD"], errors="coerce") > 0.1)]
    if len(flagged):
        print("Baseline variables with |SMD| > 0.1:", ", ".join(flagged["Variable"].str.strip()))
    return out
