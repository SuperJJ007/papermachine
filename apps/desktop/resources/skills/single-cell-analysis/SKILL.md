---
name: single-cell-analysis
description: "Single-cell RNA-seq analysis with scanpy/anndata (Python, shipped) or Seurat (R, installable) — 10x/h5ad/CSV loading, cell and gene QC (mito %, counts, doublets), normalization, HVG selection, PCA, neighbors, Leiden clustering, UMAP, marker genes, cell-type annotation, per-cluster composition, and pseudobulk DE between conditions. Use whenever a user mentions cells as rows, clusters, UMAP/t-SNE, marker genes, cell types, 10x Genomics output, or an .h5ad/.rds object. Trigger terms: 单细胞、scRNA-seq、10x、UMAP、聚类、Leiden、marker 基因、细胞类型注释、Seurat、scanpy、anndata、拟时序."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Single-Cell RNA-seq Analysis

Run the standard scanpy pipeline in the session's persistent Python kernel, keeping the `AnnData` object in memory across turns and writing only deliverables (figures, marker tables, cluster annotations) to `SCIENCE_ARTIFACT_DIR`. The result a reviewer trusts states QC thresholds with the cell counts they removed, uses an HVG set and PCA count that were chosen and recorded, resolves clustering at a stated resolution, and annotates cell types from marker evidence shown in a figure — never from cluster number alone.

## Installation

Shipped in the `biology` environment: `scanpy`, `anndata`, `leidenalg`, `python-igraph`, `umap-learn`, `scikit-learn`. Install extras with `install_science_packages`:

| Need | Language | Spec |
|------|----------|------|
| 10x `.h5` files | python | `h5py` (usually already present), `pytables` for `.h5ad` compression |
| Doublet detection | python | `scrublet` (or `scanpy.pp.scrublet`, available since scanpy 1.10 — prefer that, no install) |
| Batch integration | python | `harmonypy` (Harmony) or `scanorama`; `scvi-tools` is heavy (PyTorch) — ask before installing |
| Cell-type reference annotation | python | `celltypist` |
| Seurat in R | r | `r-seurat` (conda-forge; ~1 GB with dependencies — ask first) |
| Loom / MTX helpers | python | `loompy` |

Compatibility traps: scanpy ≥ 1.10 `sc.pp.highly_variable_genes(flavor="seurat_v3")` needs **raw counts** in `adata.X` or `layer=`; call it before `normalize_total`. `sc.tl.leiden` defaults changed — pass `flavor="igraph", n_iterations=2, directed=False` explicitly. Keep `adata.layers["counts"]`. Never `import scvi` without asking.

## Workflow

Persist `adata` as a kernel variable; if the kernel restarted, reload and replay recorded steps.

1. **Load.** `sc.read_10x_mtx(dir, var_names="gene_symbols", cache=False)`, `sc.read_10x_h5`, `sc.read_h5ad`, or `sc.read_csv(...).T` when genes are rows. Set `adata.var_names_make_unique()`. Store raw counts: `adata.layers["counts"] = adata.X.copy()`. Print `adata` dimensions and confirm integer counts.
2. **QC metrics.** Flag mito (`MT-`/`mt-`), ribosomal (`RPS|RPL`), haemoglobin (`^HB[^(P)]`) genes; `sc.pp.calculate_qc_metrics(adata, qc_vars=["mt","ribo","hb"], percent_top=[20], log1p=True, inplace=True)`. Plot violins and scatter of counts vs genes coloured by mito %. Save `qc_violin.png` (declare in `raster_artifacts`).
3. **Filter.** Default: genes in ≥ 3 cells; cells with 200 ≤ n_genes, mito % < 20 (human tissue; 5–10 % for PBMC). Prefer data-driven MAD cutoffs (`scripts/qc_thresholds.py`). Report cells before → after per sample. Run doublet detection (`sc.pp.scrublet(adata, batch_key="sample")`) and report doublet fraction (< 10 %).
4. **Normalize & features.** `sc.pp.normalize_total(adata, target_sum=1e4)`; `sc.pp.log1p(adata)`; HVGs: `sc.pp.highly_variable_genes(adata, n_top_genes=2000, flavor="seurat_v3", layer="counts", batch_key="sample")`. Keep full matrix; subset to HVGs in PCA via `use_highly_variable=True`.
5. **Reduce, integrate, cluster.** `sc.tl.pca(adata, n_comps=50, mask_var="highly_variable")`; inspect elbow for `n_pcs` (typically 20–40). If batch effect exists, integrate with Harmony (`sc.external.pp.harmony_integrate(adata, key="sample")`, `use_rep="X_pca_harmony"`). `sc.pp.neighbors(adata, n_neighbors=15, n_pcs=n_pcs)`; `sc.tl.umap(adata, random_state=0)`; `sc.tl.leiden(adata, resolution=1.0, flavor="igraph", n_iterations=2, directed=False, key_added="leiden_1.0")`. Test 2–3 resolutions (0.3/0.6/1.0); choose one and record rationale.
6. **Markers.** `sc.tl.rank_genes_groups(adata, "leiden_1.0", method="wilcoxon", pts=True)`; filter `pct_nz_group > 0.25`, `logfoldchanges > 1`, `pvals_adj < 0.05` → write `markers_by_cluster.csv`. Plot dot plot of top 5 markers per cluster and canonical marker UMAPs (`references/marker_genes.md`).
7. **Annotate.** Map cluster → cell type in a dict, store as `adata.obs["cell_type"]`, and justify labels in a table. For mixed clusters, label `Ambiguous (cluster N)` and propose subclustering. CellTypist is a second opinion, not the final word.
8. **Composition & condition DE.** Cross-tab `cell_type × sample` → stacked bar. For condition differences within cell types, use **pseudobulk**: sum counts per (sample, cell_type) and run pyDESeq2 with replicates. Cell-level Wilcoxon between conditions inflates significance; use for exploratory ranking only.
9. **Deliver.** Headline UMAP coloured by `cell_type` (`legend_loc="on data"`) with `annotate_artifact`; `cell_annotations.csv`; `markers_by_cluster.csv`; save `f"{SCIENCE_STATE_DIR}/processed.h5ad"` for state persistence.

## Figures

Use `sc.pl.*` with `show=False, return_fig=True` (or `ax=`) and save through `fig.savefig(path, dpi=150, bbox_inches="tight")` so the figure stays editable in the viewer; `sc.settings.figdir`/`save=` writes outside `SCIENCE_ARTIFACT_DIR` and is not captured. Point sizes: `size=` scaled to cell count (≈ 120000 / n_cells). Colour categorical fields with `sc.pl.umap(..., palette="tab20")` and never more than ~20 categories in one legend.

## Integrity rules

1. **Report QC thresholds and the number of cells each removed**, per sample.
2. **Clustering resolution is a choice, not a discovery.** State it; do not describe cluster count as a biological finding.
3. **Marker-based annotation shows its evidence** (dot plot or feature UMAP) for every label.
4. **Differential expression across conditions uses pseudobulk** with biological replicates; single-cell Wilcoxon p-values are exploratory.
5. **Integration removes biology as well as batch.** Show the uncorrected UMAP too, and report whether condition and batch are confounded.
6. **Seeds:** `random_state=0` in PCA/UMAP/Leiden/Scrublet; print `sc.logging.print_header()` in the report.
7. **Trajectory (PAGA/diffusion pseudotime)** is only meaningful within a continuous lineage — do not run it across unrelated cell types; `references/trajectory.md`.

## Quick reference

- Fast look: `adata.obs.groupby("sample")[["total_counts","n_genes_by_counts","pct_counts_mt"]].median()`.
- Subset to a lineage and recluster: `sub = adata[adata.obs.cell_type == "T cell"].copy()`; redo HVG → PCA → neighbors → Leiden on `sub` (never reuse the parent embedding).
- Seurat interop: `SeuratDisk`/`sceasy` conversions are fragile — prefer exporting `counts` MTX + `obs` CSV and rebuilding.
- Files: `scripts/qc_thresholds.py` (`mad_outliers`, `qc_summary`, and `pseudobulk` — aggregate raw counts to sample × cell type for pyDESeq2), `references/marker_genes.md` (canonical markers by tissue), `references/trajectory.md`.
