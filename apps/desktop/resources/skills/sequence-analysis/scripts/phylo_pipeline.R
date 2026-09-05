# Distance (NJ) + maximum-likelihood tree with bootstrap from an aligned FASTA.
#
#   source(file.path(SKILL_DIR, "scripts/phylo_pipeline.R"))
#   res <- build_trees("aligned.fasta", outgroup = "Outgroup_taxon", out_dir = Sys.getenv("SCIENCE_ARTIFACT_DIR"))
#   res$ml_tree ; res$model ; res$figures   # declare res$figures in raster_artifacts
#
# Requires ape + phangorn (shipped in the biology environment). Alignment must
# already be aligned (equal lengths); align first with MAFFT/MUSCLE or provide one.

suppressPackageStartupMessages({ library(ape); library(phangorn) })

build_trees <- function(alignment_path, outgroup = NULL, out_dir = ".", type = c("DNA", "AA"),
                        bootstrap = 100, seed = 1, prefix = "tree") {
  type <- match.arg(type)
  set.seed(seed)
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
  phy <- read.phyDat(alignment_path, format = "fasta", type = type)
  taxa <- names(phy)
  if (!is.null(outgroup) && !outgroup %in% taxa) stop("outgroup '", outgroup, "' not among taxa: ", paste(taxa, collapse = ", "))

  # --- distance tree ----------------------------------------------------------
  dm <- if (type == "DNA") dist.ml(phy, model = "JC69") else dist.ml(phy, model = "JTT")
  nj_tree <- NJ(dm)

  # --- model selection + ML ---------------------------------------------------
  mt <- modelTest(phy, tree = nj_tree, model = if (type == "DNA") c("JC", "K80", "HKY", "GTR") else c("JTT", "LG", "WAG"),
                  G = TRUE, I = TRUE, control = pml.control(trace = 0))
  best <- mt$Model[which.min(mt$BIC)]
  fit <- as.pml(mt, best)                       # phangorn >= 2.8: builds pml from the modelTest env
  fit <- optim.pml(fit, optNni = TRUE, optGamma = grepl("G", best), optInv = grepl("I", best),
                   rearrangement = "stochastic", control = pml.control(trace = 0))
  bs <- bootstrap.pml(fit, bs = bootstrap, optNni = TRUE, control = pml.control(trace = 0))
  ml_tree <- plotBS(fit$tree, bs, type = "none")   # attaches node labels (bootstrap %) without plotting

  # --- rooting ----------------------------------------------------------------
  root_tree <- function(tr) {
    if (!is.null(outgroup)) root(tr, outgroup = outgroup, resolve.root = TRUE) else midpoint(tr)
  }
  nj_tree <- root_tree(nj_tree)
  ml_tree <- root_tree(ml_tree)

  # --- outputs ----------------------------------------------------------------
  nwk <- file.path(out_dir, paste0(prefix, "_ml.nwk"))
  write.tree(ml_tree, nwk)
  write.tree(nj_tree, file.path(out_dir, paste0(prefix, "_nj.nwk")))
  write.csv(mt[, c("Model", "df", "logLik", "AIC", "BIC")], file.path(out_dir, paste0(prefix, "_model_test.csv")), row.names = FALSE)

  fig <- file.path(out_dir, paste0(prefix, "_ml.png"))
  png(fig, width = 1800, height = 1400, res = 200)
  par(mar = c(3, 1, 3, 1))
  plot.phylo(ml_tree, cex = 0.8, label.offset = 0.002, main = sprintf("ML tree (%s), %d bootstrap replicates", best, bootstrap))
  bs_vals <- suppressWarnings(as.numeric(ml_tree$node.label))
  show <- !is.na(bs_vals) & bs_vals >= 70
  if (any(show)) nodelabels(text = bs_vals[show], node = (Ntip(ml_tree) + 1:Nnode(ml_tree))[show], frame = "none", cex = 0.65, adj = c(1.2, -0.3))
  add.scale.bar()
  dev.off()

  list(nj_tree = nj_tree, ml_tree = ml_tree, model = best, model_test = mt, bootstrap = bs,
       figures = fig, newick = nwk)
}
