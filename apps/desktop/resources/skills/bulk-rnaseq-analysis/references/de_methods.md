# Choosing and running a differential-expression method

## Which engine

| Situation | Use | Why |
|-----------|-----|-----|
| 2–10 replicates per group, standard two-group or factorial design | DESeq2 / pyDESeq2 | Robust dispersion shrinkage, apeglm LFC shrinkage, sensible defaults |
| Many samples (≥ 20 per group), continuous covariates, or complex random effects via `duplicateCorrelation` | limma-voom | Linear-model flexibility; fast; well-calibrated with large n |
| Very low counts, quasi-likelihood F-test preferred by reviewers, or when the lab's pipeline is edgeR | edgeR QL | `glmQLFit`/`glmQLFTest` controls type I error tightly |
| Windows machine (no bioconda) | pyDESeq2 | Pure Python, conda-forge/bioconda noarch |
| No replicates | none | Only descriptive log2FC; state that no inferential test is valid |

All three agree on the large majority of calls for well-replicated data. Report the one you used and its version; do not run all three and pick the longest list.

## pyDESeq2 minimal path (`>= 0.5`)

```python
from pydeseq2.dds import DeseqDataSet
from pydeseq2.ds import DeseqStats

# counts: genes x samples integer DataFrame; meta: samples x covariates
keep = filter_by_expr(counts, meta["condition"])
dds = DeseqDataSet(counts=counts.loc[keep].T, metadata=meta, design="~ batch + condition", quiet=True)
dds.deseq2()
stat = DeseqStats(dds, contrast=["condition", "treated", "control"], alpha=0.05, quiet=True)
stat.summary()                                   # prints; stat.results_df holds the table
unshrunk = stat.results_df["log2FoldChange"].copy()
stat.lfc_shrink(coeff="condition[T.treated]")    # replaces log2FoldChange in place
res = stat.results_df.assign(log2FoldChange_unshrunk=unshrunk).sort_values("padj")
res.index.name = "gene"
res.to_csv(f"{SCIENCE_ARTIFACT_DIR}/de_results.csv")
```

The `coeff` name follows patsy/formulaic conventions: `<factor>[T.<level>]` where `<level>` is the non-reference level. Print `dds.obsm["design_matrix"].columns` if unsure. Set the reference level explicitly by ordering the categorical: `meta["condition"] = pd.Categorical(meta["condition"], ["control", "treated"])`.

Variance-stabilized values for heatmaps/PCA: `dds.vst()` then `dds.layers["vst_counts"]` (samples × genes).

## DESeq2 in R

```r
library(DESeq2)
dds <- DESeqDataSetFromMatrix(countData = round(counts), colData = meta, design = ~ batch + condition)
dds$condition <- relevel(dds$condition, ref = "control")
keep <- rowSums(counts(dds) >= 10) >= min(table(dds$condition))
dds <- dds[keep, ]
dds <- DESeq(dds)
res <- results(dds, contrast = c("condition", "treated", "control"), alpha = 0.05)
res_shr <- lfcShrink(dds, coef = "condition_treated_vs_control", type = "apeglm")
vsd <- vst(dds, blind = FALSE)
out <- as.data.frame(res_shr) |> tibble::rownames_to_column("gene") |> dplyr::arrange(padj)
readr::write_csv(out, file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), "de_results.csv"))
```

`apeglm` ships with DESeq2 on bioconda as a dependency; if `lfcShrink` complains, `type = "ashr"` needs `r-ashr`, and `type = "normal"` works with no extra package but over-shrinks large effects.

## edgeR quasi-likelihood

```r
library(edgeR)
dge <- DGEList(counts = counts, group = meta$condition)
keep <- filterByExpr(dge, group = meta$condition)
dge <- dge[keep, , keep.lib.sizes = FALSE]
dge <- calcNormFactors(dge, method = "TMM")
design <- model.matrix(~ batch + condition, data = meta)
dge <- estimateDisp(dge, design)
fit <- glmQLFit(dge, design)
qlf <- glmQLFTest(fit, coef = "conditiontreated")
tt <- topTags(qlf, n = Inf)$table   # logFC, logCPM, F, PValue, FDR
```

## limma-voom

```r
library(limma); library(edgeR)
dge <- calcNormFactors(DGEList(counts[keep, ]))
v <- voom(dge, design, plot = TRUE)          # keep the mean–variance plot as a QC artifact
fit <- eBayes(lmFit(v, design))
tt <- topTable(fit, coef = "conditiontreated", n = Inf, sort.by = "P")   # logFC, AveExpr, t, P.Value, adj.P.Val
```

With repeated measures on the same subject and a covariate you also want to test, use `duplicateCorrelation(v, design, block = meta$subject)` and pass `correlation =` to `lmFit`.

## Interpreting and reporting

- Thresholds: report the numbers at padj < 0.05 and |log2FC| ≥ 1, and also at padj < 0.05 alone; state which the figures use.
- Shrunken LFC for ranking, plotting, and GSEA; unshrunk LFC only if the user specifically asks for raw estimates.
- Independent filtering / Cook's outlier handling in DESeq2 sets `padj` to `NA` for some genes; do not drop those rows from the table silently — keep them and explain the `NA`.
- If the PCA showed a batch axis and batch was not in the design (because it was unknown), say that the DE list may include batch-driven genes. `sva::svaseq` or RUVSeq are follow-ups, not silent fixes.
