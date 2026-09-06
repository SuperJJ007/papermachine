# Functional enrichment after differential expression

## Two questions, two methods

| Question | Method | Input | Background |
|----------|--------|-------|------------|
| "Is my significant gene list enriched for a pathway?" | ORA (hypergeometric / Fisher) | Significant up **or** down genes (separately) | **All genes that passed the low-count filter** |
| "Does a pathway shift as a whole, even if few genes pass the threshold?" | GSEA (pre-ranked) | Every tested gene ranked by shrunken log2FC (or by `stat`) | None (uses the full ranking) |

Using the whole genome as ORA background inflates significance for every pathway expressed in the tissue — a classic reviewer catch. Combining up- and down-regulated genes into one ORA list cancels directional signal.

## Gene identifiers

Enrichment libraries key on **HGNC symbols** (Enrichr, MSigDB) or **Entrez IDs** (clusterProfiler default). Convert before enriching, keep the mapping table, and report how many genes failed to map.

- Python: `mygene.MyGeneInfo().querymany(ids, scopes="ensembl.gene", fields="symbol,entrezgene", species="human")`.
- R: `clusterProfiler::bitr(ids, fromType="ENSEMBL", toType=c("SYMBOL","ENTREZID"), OrgDb=org.Hs.eg.db)`.
- Ensembl versions (`ENSG00000141510.16`) must have the suffix stripped first: `ids.str.replace(r"\.\d+$", "", regex=True)`.

## gseapy

```python
import gseapy as gp

bg = res.index.tolist()                                   # all tested genes (symbols)
up = res.query("padj < 0.05 and log2FoldChange >= 1").index.tolist()
down = res.query("padj < 0.05 and log2FoldChange <= -1").index.tolist()

ora_up = gp.enrichr(gene_list=up, gene_sets=["GO_Biological_Process_2023", "KEGG_2021_Human"],
                    background=bg, outdir=None).results
ora_up = ora_up.sort_values("Adjusted P-value")

rnk = res["log2FoldChange"].dropna().sort_values(ascending=False)
gsea = gp.prerank(rnk=rnk, gene_sets="MSigDB_Hallmark_2020", permutation_num=1000, seed=0,
                  min_size=15, max_size=500, threads=4, outdir=None)
gsea_res = gsea.res2d.sort_values("FDR q-val")             # Term, NES, NOM p-val, FDR q-val, Lead_genes
```

Offline: pass a local `.gmt` path as `gene_sets=`. Mouse: use `_Mouse` library variants or an organism-specific GMT and mouse symbols (capitalized, e.g. `Trp53`).

Dot plot of the top terms (matplotlib, so it stays editable in the viewer):

```python
top = ora_up.head(15).iloc[::-1]
top["ratio"] = top["Overlap"].str.split("/").map(lambda x: int(x[0]) / int(x[1]))
fig, ax = plt.subplots(figsize=(7, 5.5))
sc = ax.scatter(top["ratio"], top["Term"], s=top["Overlap"].str.split("/").str[0].astype(int) * 8,
                c=-np.log10(top["Adjusted P-value"]), cmap="viridis")
fig.colorbar(sc, label="−log10 adjusted p")
ax.set_xlabel("Gene ratio"); ax.set_title("GO BP — up-regulated genes (ORA)")
fig.tight_layout(); fig.savefig(f"{SCIENCE_ARTIFACT_DIR}/enrich_up_dotplot.png", dpi=150)
```

## clusterProfiler (macOS, via bioconda)

```r
library(clusterProfiler); library(org.Hs.eg.db)
ego <- enrichGO(gene = up_entrez, universe = bg_entrez, OrgDb = org.Hs.eg.db, ont = "BP",
                pAdjustMethod = "BH", qvalueCutoff = 0.05, readable = TRUE)
ekegg <- enrichKEGG(gene = up_entrez, universe = bg_entrez, organism = "hsa")   # needs network
geneList <- sort(setNames(res$log2FoldChange, res$entrez), decreasing = TRUE)
gse <- gseGO(geneList, OrgDb = org.Hs.eg.db, ont = "BP", seed = TRUE, eps = 0)
p <- dotplot(ego, showCategory = 15) + ggtitle("GO BP — up-regulated (ORA)")
ggsave(file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), "enrich_up_dotplot.png"), p, width = 7, height = 5.5, dpi = 150)
```

`simplify(ego)` collapses redundant GO terms (semantic similarity > 0.7) — useful before plotting, and say it was applied.

## Reporting

For each enrichment: method, library and version/date, background size, gene-list size and how many mapped, correction method, top terms with adjusted p and gene ratio (ORA) or NES and FDR (GSEA), and a sentence on whether the terms are consistent with the experimental expectation. An enrichment of "ribosome" or "mitochondrial translation" in a treatment contrast is often a proliferation or quality artefact — flag it rather than narrating it as biology.
