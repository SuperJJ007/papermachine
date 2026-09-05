---
name: bulk-rnaseq-analysis
description: "Bulk RNA-seq downstream analysis from a gene × sample count matrix — count QC, library-size normalization, PCA/sample clustering, differential expression (pyDESeq2 in Python; DESeq2/edgeR/limma-voom in R), volcano/MA/heatmap figures, and GO/KEGG over-representation or GSEA enrichment. Use whenever a user has a count table, featureCounts/HTSeq/Salmon/kallisto output, a DE result table, or asks which genes change between conditions. Trigger terms: 差异表达、RNA-seq、转录组、counts 矩阵、火山图、DESeq2、edgeR、limma、GO/KEGG 富集、GSEA、热图."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Bulk RNA-seq Analysis

Take a count matrix to a defensible differential-expression result through `run_python` or `run_r`: inspect and filter counts, model the design, test, correct for multiple testing, plot, and enrich. The standard a reviewer applies is simple — the design was stated before testing, low counts were filtered honestly, shrunken fold changes are reported alongside adjusted p-values, and every figure traces back to one result table.

## Installation

The `biology` environment ships pandas, scipy, statsmodels, scikit-learn, seaborn, and R's tidyverse, pheatmap, ggpubr, rstatix. Add DE engines through `install_science_packages`, never through in-kernel `pip`/`install.packages()`:

| Need | Language | Spec |
|------|----------|------|
| DE (default, works on every platform) | python | `pydeseq2` |
| Enrichment (ORA + prerank GSEA, Enrichr libraries) | python | `gseapy` |
| DE (macOS only — bioconda ships no Windows builds) | r | `bioconductor-deseq2`, `bioconductor-edger`, `bioconductor-limma` |
| Enrichment in R (macOS only) | r | `bioconductor-clusterprofiler`, `bioconductor-org.hs.eg.db` (or `org.mm.eg.db`) |
| Gene ID mapping | python | `mygene` |

If an R Bioconductor install reports `failed`, do not fall back to `BiocManager::install()` inside the kernel; switch to the Python path (`pydeseq2` + `gseapy`), which is functionally equivalent for the two-group and multi-factor designs below. Compatibility traps: `pydeseq2>=0.5` takes `design="~ condition"` (formula string) instead of `design_factors=`; `gseapy` Enrichr libraries require network access — when offline, ask for a local GMT file and pass it as `gene_sets=`.

## Workflow

Work in order; each step's output feeds the next, and the skipped step is the one reviewers ask about.

1. **Load and orient the matrix.** Rows must be genes, columns samples, values raw integer counts (not TPM/FPKM — DESeq2/edgeR models reject normalized input; for Salmon/kallisto import TPM+counts with `tximport` in R or sum `NumReads`). Print shape, `head`, dtype, and confirm sample names match the metadata sheet exactly. State the design formula now (`~ batch + condition`) and which contrast answers the question. Choosing contrasts after peeking is p-hacking.
2. **Count QC.** Library sizes (bar chart), fraction of zero counts per sample, sample–sample correlation heatmap on log2(CPM+1), and PCA of variance-stabilized counts (`vst`/`rlog` in R, `log1p(CPM)` of the top 2,000 most variable genes in Python). Colour PCA by condition **and** by batch/sequencing run; an outlier or a batch axis explaining PC1 is a finding to report, not something to silently regress away. `scripts/count_qc.py` produces all four figures from one call.
3. **Filter low counts.** Keep genes with ≥10 counts in at least the smallest group size number of samples (edgeR's `filterByExpr` rule). Report how many genes remain of how many.
4. **Fit and test.** pyDESeq2: `DeseqDataSet(counts=counts.T, metadata=meta, design="~ condition")` → `.deseq2()` → `DeseqStats(dds, contrast=["condition","treated","control"])` → `.summary()` → `.lfc_shrink(coeff="condition[T.treated]")`. R: `DESeqDataSetFromMatrix` → `DESeq` → `results(..., alpha=0.05)` → `lfcShrink(type="apeglm")`. Always shrink log fold changes before ranking or plotting; report both `log2FoldChange` and `padj` (BH). With no replicates in a group, say plainly that no valid DE test exists and stop at descriptive fold changes.
5. **Write the result table** to `SCIENCE_ARTIFACT_DIR/de_results.csv` sorted by `padj`, with columns `gene, baseMean, log2FoldChange, lfcSE, pvalue, padj`. Every figure below is drawn from this file, never from a second in-memory copy.
6. **Figures.** Volcano (log2FC vs −log10 padj, thresholds |log2FC| ≥ 1 and padj < 0.05 drawn as lines, top 15 genes labelled), MA plot, and a heatmap of the top 30–50 DE genes on z-scored VST counts with a condition colour bar. Save each as PNG under `SCIENCE_ARTIFACT_DIR` with `fig.savefig()` (matplotlib) or `ggsave()` (ggplot2) and declare it in `raster_artifacts`. Use `annotate_artifact` on the volcano with the contrast and thresholds in the caption.
7. **Enrichment.** ORA (`gseapy.enrichr` or `clusterProfiler::enrichGO`) on significant up- and down-regulated genes separately, using **all tested genes as the background**, never the whole genome. GSEA (`gseapy.prerank` on the shrunken log2FC ranking, `permutation_num=1000`, `seed=0`) when the user wants pathway-level direction. Report term, gene ratio, adjusted p, and leading-edge genes; plot a dot plot of the top 15 terms. `references/enrichment.md` covers ID conversion and library choice.
8. **Report.** Design and contrast, filtering rule and gene counts, normalization method, number of DE genes at the stated thresholds (up/down), the top genes with shrunken log2FC and padj, and the enrichment method with background definition.

## Design guidance

- **Batch.** If batch is known and not confounded with condition, put it in the formula (`~ batch + condition`). If it is fully confounded, no model can separate them — say so.
- **Paired samples** (before/after per patient): `~ subject + condition`.
- **Interaction** (drug × genotype): `~ genotype + drug + genotype:drug`; the interaction term, not the drug main effect, answers "does the drug act differently by genotype".
- **Continuous covariate** (age, dose): keep numeric; centre it. Do not bin unless the user asks.
- **Three or more levels:** one likelihood-ratio test for "any difference", then pairwise contrasts each with its own BH correction; state which comparison each figure shows.

## Integrity rules

1. **Never filter on p-value before enrichment background is fixed.** Background = genes that passed the low-count filter.
2. **Do not change the log2FC or padj threshold to obtain a non-empty gene list.** Report the empty list and show the top-ranked genes descriptively.
3. **Adjusted p-values are the reported values.** Raw p-values appear in the table but are never used to call significance.
4. **A gene with padj < 0.05 and |log2FC| < 0.3 is statistically detected, not biologically compelling** — say both.
5. **Heatmaps are z-scored per gene; say so in the caption.** Colour scales must be symmetric around zero.
6. **Set seeds** for GSEA permutations and any subsampling, and print `pydeseq2.__version__` / `packageVersion("DESeq2")` into the report.

## Quick reference

- Count → CPM: `cpm = counts / counts.sum(0) * 1e6`; log2(CPM + 1) for plotting only.
- pyDESeq2 result frame columns: `baseMean, log2FoldChange, lfcSE, stat, pvalue, padj` (index = gene). After `lfc_shrink`, `log2FoldChange` is replaced in place — copy the unshrunk column first if the user wants both.
- edgeR path: `DGEList` → `filterByExpr` → `calcNormFactors` → `model.matrix` → `glmQLFit` → `glmQLFTest` → `topTags(n=Inf)`.
- limma-voom for large n or continuous designs: `voom(dge, design, plot=TRUE)` → `lmFit` → `eBayes` → `topTable(coef=, n=Inf)`.
- More: `references/de_methods.md` (method choice, when DESeq2 vs edgeR vs limma), `references/enrichment.md`, `scripts/count_qc.py`, `scripts/volcano.py`.
