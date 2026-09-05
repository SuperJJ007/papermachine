"""MAD-based per-sample QC outlier detection and pseudobulk aggregation for scanpy.

    exec(open(f"{SKILL_DIR}/scripts/qc_thresholds.py").read())
    flags = mad_outliers(adata, sample_key="sample")     # adds adata.obs["qc_outlier"]
    print(qc_summary(adata, sample_key="sample"))        # cells before/after per sample
    pb = pseudobulk(adata, sample_key="sample", group_key="cell_type", layer="counts")
    # pb.counts: genes x (sample|cell_type) ; pb.meta: metadata per pseudobulk column
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import scipy.sparse as sp


def _is_outlier(x: pd.Series, nmads: float) -> pd.Series:
    med = np.median(x)
    mad = np.median(np.abs(x - med)) * 1.4826
    if mad == 0:
        return pd.Series(False, index=x.index)
    return (x < med - nmads * mad) | (x > med + nmads * mad)


def mad_outliers(adata, sample_key: str | None = None, nmads_counts: float = 5.0,
                 nmads_genes: float = 5.0, nmads_mt: float = 3.0, mt_hard_cap: float = 20.0) -> pd.Series:
    """Flag cells as outliers per sample (sc-best-practices rule): |log1p counts| or
    |log1p genes| beyond `nmads_*` MADs, or mito % beyond `nmads_mt` MADs above the
    median *or* above `mt_hard_cap`. Writes adata.obs["qc_outlier"] and returns it."""
    obs = adata.obs
    required = {"log1p_total_counts", "log1p_n_genes_by_counts", "pct_counts_mt"}
    missing = required - set(obs.columns)
    if missing:
        raise ValueError(f"run sc.pp.calculate_qc_metrics(qc_vars=['mt'], log1p=True) first; missing {missing}")
    groups = [obs.index] if sample_key is None else [idx for _, idx in obs.groupby(sample_key, observed=True).groups.items()]
    flag = pd.Series(False, index=obs.index)
    for idx in groups:
        sub = obs.loc[idx]
        f = _is_outlier(sub["log1p_total_counts"], nmads_counts) | _is_outlier(sub["log1p_n_genes_by_counts"], nmads_genes)
        mt = sub["pct_counts_mt"]
        med = np.median(mt); mad = np.median(np.abs(mt - med)) * 1.4826
        f |= (mt > med + nmads_mt * mad) | (mt > mt_hard_cap)
        flag.loc[idx] = f
    adata.obs["qc_outlier"] = flag.values
    return flag


def qc_summary(adata, sample_key: str = "sample", flag_key: str = "qc_outlier") -> pd.DataFrame:
    """Cells per sample before/after removing flagged cells, with medians of key metrics."""
    obs = adata.obs
    g = obs.groupby(sample_key, observed=True)
    out = pd.DataFrame({
        "cells_before": g.size(),
        "cells_flagged": g[flag_key].sum().astype(int),
    })
    out["cells_after"] = out["cells_before"] - out["cells_flagged"]
    out["pct_removed"] = (100 * out["cells_flagged"] / out["cells_before"]).round(1)
    kept = obs[~obs[flag_key]].groupby(sample_key, observed=True)
    out["median_counts"] = kept["total_counts"].median().round(0)
    out["median_genes"] = kept["n_genes_by_counts"].median().round(0)
    out["median_pct_mt"] = kept["pct_counts_mt"].median().round(2)
    return out


@dataclass
class Pseudobulk:
    counts: pd.DataFrame   # genes x pseudobulk columns (integer sums)
    meta: pd.DataFrame     # one row per column: sample, group, n_cells + sample-level covariates


def pseudobulk(adata, sample_key: str, group_key: str, layer: str = "counts",
               min_cells: int = 10, covariates: list[str] | None = None) -> Pseudobulk:
    """Sum raw counts per (sample, group). Columns with < min_cells cells are dropped.
    The result feeds pyDESeq2 directly: DeseqDataSet(counts=pb.counts.T, metadata=pb.meta, ...)."""
    X = adata.layers[layer] if layer else adata.X
    if not sp.issparse(X):
        X = sp.csr_matrix(X)
    key = adata.obs[sample_key].astype(str) + "|" + adata.obs[group_key].astype(str)
    cats = pd.Categorical(key)
    indicator = sp.csr_matrix((np.ones(len(cats)), (cats.codes, np.arange(len(cats)))), shape=(len(cats.categories), len(cats)))
    sums = indicator @ X                                  # pseudobulk x genes
    counts = pd.DataFrame(np.asarray(sums.todense()).T.round().astype(int), index=adata.var_names, columns=cats.categories)
    n_cells = pd.Series(np.asarray(indicator.sum(axis=1)).ravel(), index=cats.categories)
    meta = pd.DataFrame({"n_cells": n_cells})
    meta["sample"] = [c.split("|")[0] for c in meta.index]
    meta["group"] = [c.split("|", 1)[1] for c in meta.index]
    if covariates:
        sample_level = adata.obs[[sample_key] + covariates].drop_duplicates(sample_key).set_index(sample_key)
        meta = meta.join(sample_level, on="sample")
    keep = meta["n_cells"] >= min_cells
    return Pseudobulk(counts=counts.loc[:, keep], meta=meta.loc[keep])
