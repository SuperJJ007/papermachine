# Community diversity helpers around vegan / ape. Samples are rows, taxa are columns throughout.
#
#   source(file.path(SKILL_DIR, "scripts/community_analysis.R"))
#   alpha <- alpha_table(otu, meta, group = "treatment", depth = NULL)      # rarefies to min depth when depth is NULL
#   beta  <- beta_diversity(otu, meta, group = "treatment", method = "bray", out_dir = Sys.getenv("SCIENCE_ARTIFACT_DIR"))
#   beta$permanova ; beta$dispersion ; beta$pairwise ; beta$figures        # declare beta$figures in raster_artifacts
#   bars  <- top_taxa_bars(otu, meta, taxonomy, rank = "Genus", group = "treatment", top_n = 12, out_dir = ...)

suppressPackageStartupMessages({ library(vegan); library(ape); library(ggplot2); library(dplyr); library(tidyr) })

alpha_table <- function(otu, meta, group, depth = NULL, seed = 1) {
  set.seed(seed)
  otu <- as.matrix(otu); storage.mode(otu) <- "integer"
  stopifnot(all(rownames(otu) %in% rownames(meta)))
  meta <- meta[rownames(otu), , drop = FALSE]
  d <- if (is.null(depth)) min(rowSums(otu)) else depth
  keep <- rowSums(otu) >= d
  rar <- rrarefy(otu[keep, ], sample = d)
  est <- t(estimateR(rar))
  out <- data.frame(
    sample = rownames(rar), group = meta[rownames(rar), group],
    reads_raw = rowSums(otu[keep, ]), depth_used = d,
    goods_coverage = 1 - rowSums(otu[keep, ] == 1) / rowSums(otu[keep, ]),
    observed = specnumber(rar), chao1 = est[, "S.chao1"], chao1_se = est[, "se.chao1"],
    shannon_ln = diversity(rar, "shannon"), gini_simpson = diversity(rar, "simpson"),
    inv_simpson = diversity(rar, "invsimpson"), row.names = NULL)
  out$pielou_evenness <- out$shannon_ln / log(out$observed)
  attr(out, "dropped_samples") <- rownames(otu)[!keep]
  out
}

pairwise_permanova <- function(dist, groups, permutations = 999, p_adjust = "BH") {
  groups <- as.factor(groups); lv <- levels(groups); res <- list()
  for (i in seq_len(length(lv) - 1)) for (j in (i + 1):length(lv)) {
    sel <- groups %in% c(lv[i], lv[j])
    dm <- as.dist(as.matrix(dist)[sel, sel])
    a <- adonis2(dm ~ g, data = data.frame(g = droplevels(groups[sel])), permutations = permutations)
    res[[length(res) + 1]] <- data.frame(pair = paste(lv[i], "vs", lv[j]), F = a$F[1], R2 = a$R2[1], p = a$`Pr(>F)`[1])
  }
  out <- bind_rows(res); out$p_adj <- p.adjust(out$p, p_adjust); out
}

beta_diversity <- function(otu, meta, group, method = "bray", transform = c("total", "hellinger", "none"),
                           rarefy_to = NULL, out_dir = ".", seed = 1, permutations = 999, prefix = "beta") {
  transform <- match.arg(transform); set.seed(seed)
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
  otu <- as.matrix(otu); meta <- meta[rownames(otu), , drop = FALSE]
  if (!is.null(rarefy_to)) { keep <- rowSums(otu) >= rarefy_to; otu <- rrarefy(otu[keep, ], rarefy_to); meta <- meta[rownames(otu), , drop = FALSE] }
  x <- if (transform == "none") otu else decostand(otu, transform)
  dist <- vegdist(x, method = method, binary = method == "jaccard")
  g <- factor(meta[[group]])

  pc <- pcoa(dist, correction = "cailliez")
  eig <- pc$values; rel <- if ("Rel_corr_eig" %in% names(eig)) eig$Rel_corr_eig else eig$Relative_eig
  scores_pc <- data.frame(sample = rownames(pc$vectors), PCo1 = pc$vectors[, 1], PCo2 = pc$vectors[, 2], group = g)
  nm <- metaMDS(dist, k = 2, try = 20, trymax = 100, trace = 0)
  scores_nm <- data.frame(sample = rownames(nm$points), NMDS1 = nm$points[, 1], NMDS2 = nm$points[, 2], group = g)

  perm <- adonis2(dist ~ g, data = data.frame(g = g), permutations = permutations)
  bd <- betadisper(dist, g); bd_test <- permutest(bd, permutations = permutations)
  pw <- if (nlevels(g) > 2) pairwise_permanova(dist, g, permutations) else NULL

  figs <- character()
  p1 <- ggplot(scores_pc, aes(PCo1, PCo2, colour = group)) + geom_point(size = 2.6) + stat_ellipse(level = 0.95) +
    labs(x = sprintf("PCo1 (%.1f%%)", 100 * rel[1]), y = sprintf("PCo2 (%.1f%%)", 100 * rel[2]),
         title = sprintf("PCoA — %s distance", method),
         subtitle = sprintf("PERMANOVA R² = %.3f, p = %.3f; dispersion p = %.3f", perm$R2[1], perm$`Pr(>F)`[1], bd_test$tab$`Pr(>F)`[1])) +
    theme_bw()
  f1 <- file.path(out_dir, paste0(prefix, "_pcoa.png")); ggsave(f1, p1, width = 6.5, height = 5, dpi = 150); figs <- c(figs, f1)
  p2 <- ggplot(scores_nm, aes(NMDS1, NMDS2, colour = group)) + geom_point(size = 2.6) + stat_ellipse(level = 0.95) +
    labs(title = sprintf("NMDS — %s distance", method), subtitle = sprintf("stress = %.3f (k = 2)%s", nm$stress, if (nm$converged) "" else ", NOT converged")) + theme_bw()
  f2 <- file.path(out_dir, paste0(prefix, "_nmds.png")); ggsave(f2, p2, width = 6.5, height = 5, dpi = 150); figs <- c(figs, f2)

  tests <- bind_rows(
    data.frame(test = "PERMANOVA (adonis2)", term = group, statistic = perm$F[1], R2 = perm$R2[1], p = perm$`Pr(>F)`[1]),
    data.frame(test = "betadisper permutest", term = group, statistic = bd_test$tab$F[1], R2 = NA, p = bd_test$tab$`Pr(>F)`[1]))
  write.csv(tests, file.path(out_dir, paste0(prefix, "_tests.csv")), row.names = FALSE)
  if (!is.null(pw)) write.csv(pw, file.path(out_dir, paste0(prefix, "_pairwise_permanova.csv")), row.names = FALSE)
  write.csv(full_join(scores_pc, scores_nm, by = c("sample", "group")), file.path(out_dir, paste0(prefix, "_ordination_scores.csv")), row.names = FALSE)

  list(dist = dist, pcoa = pc, nmds = nm, permanova = perm, dispersion = bd_test, pairwise = pw,
       scores = list(pcoa = scores_pc, nmds = scores_nm), figures = figs, tests = tests)
}

top_taxa_bars <- function(otu, meta, taxonomy, rank = "Genus", group, top_n = 12, out_dir = ".", prefix = "composition") {
  otu <- as.matrix(otu); rel <- otu / rowSums(otu)
  tax <- as.character(taxonomy[colnames(otu), rank]); tax[is.na(tax) | tax == ""] <- "Unclassified"
  agg <- t(rowsum(t(rel), tax))                                  # samples x rank levels
  top <- names(sort(colMeans(agg), decreasing = TRUE))[seq_len(min(top_n, ncol(agg)))]
  other <- rowSums(agg[, !colnames(agg) %in% top, drop = FALSE])
  df <- as.data.frame(agg[, top, drop = FALSE]); df$Other <- other; df$sample <- rownames(df); df$group <- meta[rownames(df), group]
  long <- pivot_longer(df, -c(sample, group), names_to = rank, values_to = "rel_abundance")
  long[[rank]] <- factor(long[[rank]], levels = c(top, "Other"))
  p <- ggplot(long, aes(sample, rel_abundance, fill = .data[[rank]])) + geom_col(width = 0.9) +
    facet_grid(~ group, scales = "free_x", space = "free_x") +
    scale_y_continuous(labels = scales::percent) + labs(y = "Relative abundance", x = NULL, title = sprintf("Top %d %s", top_n, rank)) +
    theme_bw() + theme(axis.text.x = element_text(angle = 90, vjust = 0.5, hjust = 1, size = 7))
  f <- file.path(out_dir, paste0(prefix, "_", tolower(rank), "_bars.png")); ggsave(f, p, width = 10, height = 5.5, dpi = 150)
  write.csv(long, file.path(out_dir, paste0(prefix, "_", tolower(rank), "_relative_abundance.csv")), row.names = FALSE)
  list(figure = f, table = long)
}
