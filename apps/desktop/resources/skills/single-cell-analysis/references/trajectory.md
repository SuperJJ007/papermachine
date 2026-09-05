# Trajectory and pseudotime — when and how

## Preconditions (all must hold)

1. The cells form **one continuous process** (differentiation, activation, cell cycle) — not a set of terminally distinct types. Run trajectory on a lineage subset (`sub = adata[adata.obs.cell_type.isin([...])].copy()`), recomputed from HVG → PCA → neighbors on that subset.
2. A **root** is biologically justified (stem/progenitor markers, earliest time point) and named before running.
3. Batch effects within the subset have been checked; pseudotime happily orders cells by sample if you let it.

If any fails, report a UMAP with marker gradients instead and say why pseudotime was not computed.

## PAGA + diffusion pseudotime (scanpy, no install)

```python
sc.pp.neighbors(sub, n_neighbors=30, n_pcs=30)
sc.tl.leiden(sub, resolution=0.6, flavor="igraph", n_iterations=2, directed=False)
sc.tl.paga(sub, groups="leiden")
sc.pl.paga(sub, threshold=0.1, show=False)             # keep as a QC artifact
sc.tl.umap(sub, init_pos="paga", random_state=0)

root_cluster = "3"                                     # justified by marker evidence
sub.uns["iroot"] = int(np.flatnonzero(sub.obs["leiden"] == root_cluster)[0])
sc.tl.diffmap(sub, n_comps=15)
sc.tl.dpt(sub, n_dcs=10)
```

Deliver: UMAP coloured by `dpt_pseudotime`, PAGA graph, and a heatmap of genes ordered by pseudotime (`sc.pl.heatmap(sub[np.argsort(sub.obs.dpt_pseudotime)], var_names=genes, groupby=None)` or bin cells into 20 pseudotime bins and average). Pseudotime is unitless; never call it "hours" unless calibrated against real time points.

## Alternatives (install on request)

| Tool | Spec | Use when |
|------|------|----------|
| Slingshot (R) | `bioconductor-slingshot` (macOS) | Branching lineages with principal curves; reviewers in developmental biology expect it |
| Monocle 3 (R) | not on conda-forge/bioconda in full — install is fragile; discourage | |
| scVelo / CellRank | `scvelo`, `cellrank` (python) | Only with spliced/unspliced layers from velocyto/kallisto-bustools; ask for the loom |
| Palantir | `palantir` | Probabilistic fate on diffusion components |

## Reporting

State the subset, root and its justification, method and parameters (`n_neighbors`, `n_dcs`), and show that known early/late markers are monotonic along the inferred axis. A trajectory that contradicts a known marker gradient is wrong, not novel.
