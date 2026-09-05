"""Count-matrix QC figures for bulk RNA-seq.

Usage inside run_python (the kernel already has pandas/matplotlib/seaborn):

    exec(open(f"{SKILL_DIR}/scripts/count_qc.py").read())   # or paste the file
    counts = pd.read_csv(".../counts.csv", index_col=0)      # genes x samples
    meta   = pd.read_csv(".../metadata.csv", index_col=0)    # samples x covariates
    qc = count_qc(counts, meta, color="condition", shape="batch", outdir=SCIENCE_ARTIFACT_DIR)
    # qc["figures"] lists the PNG paths to declare in raster_artifacts.

Every function returns plain pandas objects; nothing here writes outside `outdir`.
"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns


def log_cpm(counts: pd.DataFrame, prior: float = 1.0) -> pd.DataFrame:
    """log2(CPM + prior). Plotting-only transform; never feed it to a DE model."""
    lib = counts.sum(axis=0)
    return np.log2(counts.div(lib, axis=1) * 1e6 + prior)


def filter_by_expr(counts: pd.DataFrame, group: pd.Series, min_count: int = 10) -> pd.Series:
    """edgeR-style low-count filter: keep genes with >= min_count in at least
    (smallest group size) samples. Returns a boolean mask over genes."""
    smallest = int(group.value_counts().min())
    return (counts >= min_count).sum(axis=1) >= smallest


def count_qc(
    counts: pd.DataFrame,
    meta: pd.DataFrame,
    color: str,
    shape: Optional[str] = None,
    outdir: str = ".",
    n_top_var: int = 2000,
) -> dict:
    """Library-size bars, zero fraction, sample correlation heatmap, PCA.

    Returns {"figures": [paths], "pca": DataFrame, "library_size": Series}.
    """
    os.makedirs(outdir, exist_ok=True)
    counts = counts.loc[:, meta.index]  # enforce sample order == metadata order
    figures = []

    lib = counts.sum(axis=0)
    zero_frac = (counts == 0).mean(axis=0)

    # 1. library size + zero fraction -------------------------------------
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    order = lib.sort_values().index
    axes[0].barh(order, lib[order] / 1e6, color=sns.color_palette("deep")[0])
    axes[0].set_xlabel("Library size (millions of counts)")
    axes[0].set_title("Library size per sample")
    axes[1].barh(order, zero_frac[order], color=sns.color_palette("deep")[1])
    axes[1].set_xlabel("Fraction of genes with zero counts")
    axes[1].set_title("Zero fraction per sample")
    fig.tight_layout()
    p = os.path.join(outdir, "qc_library_size.png")
    fig.savefig(p, dpi=150)
    plt.close(fig)
    figures.append(p)

    # 2. sample-sample correlation -----------------------------------------
    lc = log_cpm(counts)
    corr = lc.corr(method="spearman")
    annot = meta[[c for c in [color, shape] if c]].copy()
    lut = {}
    row_colors = pd.DataFrame(index=annot.index)
    for col in annot.columns:
        levels = annot[col].astype(str).unique()
        pal = dict(zip(levels, sns.color_palette("Set2", len(levels))))
        lut[col] = pal
        row_colors[col] = annot[col].astype(str).map(pal)
    g = sns.clustermap(corr, cmap="viridis", row_colors=row_colors, col_colors=row_colors,
                       figsize=(8, 8), cbar_kws={"label": "Spearman r (log2 CPM)"})
    g.fig.suptitle("Sample–sample correlation", y=1.02)
    p = os.path.join(outdir, "qc_sample_correlation.png")
    g.savefig(p, dpi=150)
    plt.close(g.fig)
    figures.append(p)

    # 3. PCA on top-variance genes -----------------------------------------
    top = lc.var(axis=1).sort_values(ascending=False).head(n_top_var).index
    x = lc.loc[top].T
    x = x - x.mean(axis=0)
    u, s, vt = np.linalg.svd(x.values, full_matrices=False)
    var_exp = s ** 2 / (s ** 2).sum()
    pcs = pd.DataFrame(u[:, :4] * s[:4], index=x.index, columns=[f"PC{i+1}" for i in range(4)])
    pcs = pcs.join(meta)

    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    sns.scatterplot(data=pcs, x="PC1", y="PC2", hue=color, style=shape, s=110, ax=ax, edgecolor="black")
    for name, row in pcs.iterrows():
        ax.annotate(str(name), (row["PC1"], row["PC2"]), fontsize=7, xytext=(4, 4), textcoords="offset points")
    ax.set_xlabel(f"PC1 ({var_exp[0]*100:.1f}%)")
    ax.set_ylabel(f"PC2 ({var_exp[1]*100:.1f}%)")
    ax.set_title(f"PCA on top {len(top)} variable genes (log2 CPM)")
    ax.axhline(0, lw=0.5, color="grey"); ax.axvline(0, lw=0.5, color="grey")
    fig.tight_layout()
    p = os.path.join(outdir, "qc_pca.png")
    fig.savefig(p, dpi=150)
    plt.close(fig)
    figures.append(p)

    return {"figures": figures, "pca": pcs, "library_size": lib, "zero_fraction": zero_frac,
            "variance_explained": pd.Series(var_exp[:4], index=pcs.columns[:4])}
