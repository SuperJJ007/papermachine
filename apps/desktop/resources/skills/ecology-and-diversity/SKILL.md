---
name: ecology-and-diversity
description: "Community ecology and microbiome diversity analysis with vegan (R, shipped) or scikit-bio/scipy (Python) — species/OTU/ASV abundance tables, rarefaction and coverage, alpha diversity (richness, Shannon, Simpson, Chao1, Faith's PD) with group comparisons, beta diversity (Bray–Curtis, Jaccard, UniFrac) with PCoA/NMDS ordination, PERMANOVA (adonis2) and dispersion tests (betadisper), indicator/differentially abundant taxa (ANCOM-BC, ALDEx2, or CLR + Wilcoxon), constrained ordination (RDA/CCA/dbRDA) against environmental variables, Mantel tests, species accumulation curves, and stacked taxonomic bar plots. Use whenever a user has samples × taxa counts, a QIIME2/DADA2/mothur/Kraken output, an environmental matrix, or asks about diversity, community composition, or which taxa differ between habitats/treatments. Trigger terms: 多样性、α 多样性、β 多样性、Shannon、Simpson、Chao1、稀释曲线、群落结构、NMDS、PCoA、PERMANOVA、adonis、Bray-Curtis、UniFrac、微生物组、16S、OTU、ASV、物种丰度、RDA、CCA、指示种、物种累积曲线."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Ecology and Diversity Analysis

Analyze community abundance tables through `run_r` (vegan is the reference implementation; use it by default) or `run_python` (scipy/scikit-bio) and write ordinations, diversity tables, and taxon bar plots to `SCIENCE_ARTIFACT_DIR`. The reviewer's checklist: sampling depth was handled explicitly (rarefaction or a depth-aware method) and the decision is stated; alpha and beta diversity use named indices and distances; PERMANOVA is accompanied by a dispersion test because a significant `adonis2` can mean different spread, not different centroids; and differential-abundance claims are made with a compositionally aware method or clearly labelled exploratory.

## Installation

Shipped: `r-vegan`, `r-ape` (PCoA, phylogenetic distances), `r-phangorn`, `r-pheatmap`, `r-ggpubr`, `r-rstatix`; Python `scipy`, `scikit-learn`, `scikit-posthocs`. Optional through `install_science_packages`:

| Need | Language | Spec |
|------|----------|------|
| phyloseq object workflow (import QIIME2/BIOM, tree, taxonomy) | r | `bioconductor-phyloseq` (macOS) |
| Differential abundance (compositional) | r | `bioconductor-ancombc`, `bioconductor-aldex2` (macOS); python: `scikit-bio` (ANCOM, conda-forge) |
| Indicator species | r | `r-indicspecies` (conda-forge) |
| UniFrac and Faith's PD | python | `scikit-bio`; r: `r-picante` (conda-forge, Faith's PD) or `bioconductor-phyloseq` (UniFrac, macOS) |
| Rarefaction with coverage (iNEXT) | r | `r-inext` (conda-forge) |
| Zero-replacement for CLR | r | `r-zcompositions` |
| Microbiome-specific plots | r | `bioconductor-microbiome` (macOS) |

Compatibility traps: vegan expects **samples as rows, taxa as columns** — transpose QIIME/DADA2 output (`t(otu)`). Use `adonis2(dist ~ group, data = meta, permutations = 999, by = "margin")` with `set.seed(1)`. On Bray–Curtis matrices with many zeros, `metaMDS` may need `try = 20, trymax = 100`. `rarefy`/`rrarefy` need integer counts. `diversity(x, "simpson")` returns Gini–Simpson (1 − D); `"invsimpson"` returns 1/D. UniFrac needs a rooted tree matching taxa columns.

## Workflow

1. **Orient data.** Samples × taxa integer table, sample metadata, optional taxonomy and phylogenetic tree. Print library sizes (min/median/max), per-taxon prevalence, and singleton fraction. Remove unassigned taxa, mitochondria/chloroplast, and low-depth samples (plateau depth or ≥ 1,000 reads). Record removals.
2. **Rarefaction & depth.** Draw rarefaction curves (`vegan::rarecurve`); save `rarefaction_curves.png`. State strategy: rarefy once with seed (`rrarefy(x, sample = d)`), use `avgdist` (repeated rarefaction, preferred for beta diversity), or use depth-aware methods (CLR/ANCOM-BC). Report Good's coverage (`1 − singletons / reads`).
3. **Alpha diversity.** Per sample: observed richness (`specnumber`), Chao1 (`estimateR`), Shannon (`diversity`), Gini–Simpson, Pielou's evenness (`H / log(S)`), Faith's PD with tree. Export `alpha_diversity.csv`. Compare across groups via Kruskal–Wallis + Dunn (BH) or ANOVA; plot boxplots with points (`ggpubr::ggboxplot(add = "jitter")`). Use `lme4::lmer` for nested/repeated designs.
4. **Beta diversity.** Distance: Bray–Curtis (abundance), Jaccard (presence/absence), Aitchison (Euclidean on CLR), weighted/unweighted UniFrac. Ordination: PCoA (`ape::pcoa`, report % variance of axes 1–2) or NMDS (`metaMDS(k = 2)`, report stress). Plot with 95% ellipses (`stat_ellipse`) and `envfit` vectors (p < 0.05). `scripts/community_analysis.R::beta_diversity()` runs full pipeline in one call.
5. **Test community differences.** `adonis2(dist ~ group, data = meta, permutations = 999)` for pseudo-F, R², p; **always** run `betadisper` + `permutest` for dispersion homogeneity. Pairwise PERMANOVA for > 2 groups with BH. For nested designs, restrict permutations (`how(blocks = meta$site)`). For environmental gradients, run dbRDA (`capscale`) or Mantel tests (`mantel`).
6. **Composition & taxa.** Aggregate to phylum/genus, plot top 10–15 taxa stacked bars (`geom_col(position = "fill")`) and top 30 taxa heatmap (`pheatmap` on log10 relative abundance). Differential abundance: ANCOM-BC2/ALDEx2 when installed; otherwise CLR + Wilcoxon/Kruskal (BH), labelled *exploratory*. Report effect sizes, not just q-values.
7. **Deliver.** `alpha_diversity.csv`, `beta_diversity_tests.csv`, `ordination_scores.csv`, `differential_taxa.csv`, `top_taxa_relative_abundance.csv`; figures: rarefaction, alpha boxplots, ordination, stacked bars, heatmap; `annotate_artifact` ordination with distance, method, stress/variance, R² and p.

## Integrity rules

1. **State the depth decision** (rarefied to N with seed / not rarefied and why) and report Good's coverage.
2. **Every PERMANOVA is reported with its dispersion test**; a significant betadisper means "composition or spread differs" — say so.
3. **NMDS without stress, PCoA without % variance, are not reportable.**
4. **Distances and indices are named precisely** (Bray–Curtis on relative abundance; Shannon, ln base; Gini–Simpson).
5. **Relative-abundance t-tests are not differential-abundance evidence.** Use a compositional method or label results exploratory.
6. **Pseudoreplication**: multiple samples from one site/animal/plot are not independent — block or nest them.
7. **Do not drop rare taxa before alpha diversity** (richness estimators need singletons); filtering by prevalence is for differential abundance only, and its threshold is reported.
8. **Seeds** before rarefaction, NMDS, and permutation tests; print `packageVersion("vegan")`.

## Quick reference (vegan)

```r
library(vegan); set.seed(1)
otu <- t(as.matrix(counts))                      # samples x taxa
depth <- min(rowSums(otu)); rar <- rrarefy(otu, depth)
alpha <- data.frame(S = specnumber(rar), shannon = diversity(rar, "shannon"), invsimpson = diversity(rar, "invsimpson"),
                    chao1 = t(estimateR(rar))[, "S.chao1"]); alpha$evenness <- alpha$shannon / log(alpha$S)
bc <- vegdist(decostand(rar, "total"), method = "bray")   # or avgdist(otu, sample = depth, iterations = 100)
pc <- ape::pcoa(bc); pc$values$Relative_eig[1:2]
nm <- metaMDS(bc, k = 2, try = 20, trymax = 100); nm$stress
adonis2(bc ~ group, data = meta, permutations = 999)
permutest(betadisper(bc, meta$group), permutations = 999)
ef <- envfit(nm, meta[, c("pH", "temperature")], permutations = 999); ef
rda_fit <- capscale(bc ~ pH + temperature, data = meta); anova(rda_fit, by = "margin", permutations = 999)
```

Files: `scripts/community_analysis.R` (`alpha_table`, `beta_diversity`, `pairwise_permanova`, `top_taxa_bars`), `references/methods_notes.md` (choosing distances and transformations, rarefaction debate, compositional data, reporting template).
