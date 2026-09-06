# Methods notes: distances, transformations, rarefaction, compositional data, reporting

## Choosing a distance

| Question | Distance | Input |
|----------|----------|-------|
| Do abundant taxa differ? | Bray–Curtis | relative or rarefied counts |
| Does membership differ (rare taxa matter)? | Jaccard (binary) | presence/absence |
| Do phylogenetically related lineages differ? | Weighted UniFrac (abundance) / unweighted UniFrac (membership) | counts + rooted tree |
| Compositional, want a Euclidean geometry (PCA, linear models) | Aitchison = Euclidean on CLR | counts + zero replacement |
| Environmental / continuous variables between sites | Euclidean on standardized variables (`decostand(env, "standardize")`) | env matrix |

Show at least two (one abundance-weighted, one presence/absence); concordant conclusions are stronger, discordant ones are informative (rare vs dominant taxa drive the difference).

## Transformations before ordination

- `decostand(x, "total")` — relative abundance; pairs with Bray–Curtis.
- `decostand(x, "hellinger")` — square-root of relative abundance; the standard input for **RDA/PCA** on abundance data (Legendre & Gallagher 2001), down-weights dominant taxa.
- `log1p` or `decostand(x, "log")` — compresses dominance; state the base.
- CLR: `log(x + pseudocount) − mean(log(x + pseudocount))` per sample; pseudocount = 0.5 or `zCompositions::cmultRepl(x, method = "CZM")`.
- Wisconsin double standardization (`wisconsin`) — `metaMDS` applies it automatically to raw counts when `autotransform = TRUE`; pass a distance matrix to avoid surprises.

## Rarefaction: the honest position

Rarefying discards data and adds sampling noise (McMurdie & Holmes 2014), but it is the simplest way to make richness comparable across samples with very unequal depth and remains standard for alpha diversity and UniFrac. Practical rule: **alpha diversity and presence/absence metrics** — rarefy (once with a seed, or average over repeats); **abundance-weighted beta diversity** — `avgdist` (repeated rarefaction) or relative abundance; **differential abundance** — never rarefy, use a model that handles depth (ANCOM-BC, ALDEx2, DESeq2-with-caveats). Whatever you choose, state the depth, how many samples were dropped, and Good's coverage.

## Compositional data in one paragraph

Sequencing counts are constrained by depth: an increase in one taxon's relative abundance forces others down. Correlations and t-tests on relative abundances therefore produce spurious associations. Log-ratio methods (CLR, ALR, ILR; ANCOM-BC's bias correction; ALDEx2's Monte-Carlo Dirichlet instances) address this. Report differential abundance as log fold change with CI or CLR difference, and disclose the method's reference frame and the prevalence filter.

## PERMANOVA and dispersion

`adonis2` tests whether group centroids differ **in the multivariate space of the chosen distance**, but is sensitive to unequal dispersion, especially with unbalanced groups. `betadisper` + `permutest` tests dispersion homogeneity. Report both; interpret a significant PERMANOVA with a significant dispersion test as "communities differ in location and/or spread". R² is the effect size — an R² of 0.03 with p = 0.001 is a tiny effect detectable because n is large.

For nested designs use restricted permutations: `how(blocks = meta$site, nperm = 999)` or `plots = Plots(strata = meta$site, type = "free")`. For repeated measures on the same individual, permute within individual.

## Ordination choices

- **PCoA** — metric, preserves the distance as well as possible in few axes; report % variance of the plotted axes and whether negative eigenvalues required a correction.
- **NMDS** — rank-based, robust to non-linearity; report stress (and the Shepard plot when stress > 0.15) and that it converged. Axes have no % variance.
- **RDA / dbRDA / CCA** — constrained by environmental variables; report the proportion of constrained variance, the global permutation test, and per-term marginal tests (`anova.cca(by = "margin")`). Check collinearity (`vif.cca` < 10) and use forward selection (`ordiR2step`) only with an adjusted R² stopping rule.

## Alpha diversity indices, precisely

- Observed richness S; Chao1 (needs singletons and doubletons; undefined without them); ACE.
- Shannon H′ = −Σ p ln p (natural log unless stated; "effective number of species" = exp(H′)).
- Simpson: D = Σ p²; Gini–Simpson 1 − D; inverse Simpson 1/D (Hill number of order 2). Say which.
- Pielou J = H′ / ln S.
- Faith's PD: sum of branch lengths spanning the sample's taxa (needs a rooted tree).
- Hill numbers (q = 0, 1, 2) give a unified profile: `vegan::renyi(x, hill = TRUE)` or `iNEXT`.

## Reporting template

> After removing chloroplast/mitochondrial ASVs and samples with < 1,000 reads (n = 2 removed), samples were rarefied to 8,412 reads (seed 1; Good's coverage ≥ 0.98). Alpha diversity (Shannon, ln) differed among treatments (Kruskal–Wallis H = …, p = …; Dunn's test, BH-adjusted: A vs B p = …). Community composition (Bray–Curtis on relative abundance) differed by treatment (PERMANOVA, 999 permutations, pseudo-F = …, R² = 0.18, p = 0.001) with homogeneous dispersions (betadisper p = 0.41); NMDS stress = 0.12. Genus-level differential abundance (ANCOM-BC2, prevalence ≥ 10 %) identified … taxa (|log FC| > 1, q < 0.05). Analyses used vegan v…
