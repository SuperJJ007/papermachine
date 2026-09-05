# Canonical marker genes (human symbols; mouse: capitalize first letter only, e.g. `Ptprc`)

Use these as a starting checklist for a feature-UMAP panel and a dot plot. A label needs at least two concordant markers **and** the absence of the neighbouring lineage's markers. Always verify against the user's tissue and species; expression is context-dependent.

## Immune (PBMC / tumour infiltrate / spleen)

| Cell type | Positive markers | Notes |
|-----------|------------------|-------|
| All immune | `PTPRC` (CD45) | Absent in epithelial/stromal |
| T cells | `CD3D`, `CD3E`, `CD2` | |
| CD4 T | `CD4`, `IL7R`, `CCR7` (naive), `FOXP3`+`IL2RA` (Treg) | `CD4` mRNA is low; rely on `IL7R` + absence of `CD8A` |
| CD8 T | `CD8A`, `CD8B`, `GZMK` (memory), `GZMB`+`PRF1` (cytotoxic) | |
| NK | `NKG7`, `GNLY`, `KLRD1`, `NCAM1`, no `CD3E` | `NKG7`/`GNLY` also in cytotoxic CD8 |
| B cells | `MS4A1` (CD20), `CD79A`, `CD79B`, `CD19` | |
| Plasma cells | `MZB1`, `JCHAIN`, `SDC1`, `XBP1`, high `IGHG*` | Low `MS4A1` |
| Classical monocytes | `CD14`, `LYZ`, `S100A8`, `S100A9` | |
| Non-classical monocytes | `FCGR3A` (CD16), `MS4A7`, `LST1` | |
| Macrophages | `CD68`, `C1QA`, `C1QB`, `APOE`, `MRC1` (M2-like) | Tissue-resident |
| cDC1 | `CLEC9A`, `XCR1` | Rare |
| cDC2 | `CD1C`, `FCER1A`, `CLEC10A` | |
| pDC | `LILRA4`, `IL3RA`, `CLEC4C`, `IRF7` | |
| Mast cells | `TPSAB1`, `CPA3`, `KIT` | |
| Neutrophils | `FCGR3B`, `CSF3R`, `S100A8`, `CXCR2` | Poorly captured by 10x; low RNA |
| Platelets / megakaryocytes | `PPBP`, `PF4` | Often a contaminant cluster |
| Erythrocytes | `HBB`, `HBA1`, `HBA2` | Remove unless studied |
| Proliferating (any lineage) | `MKI67`, `TOP2A`, `STMN1` | Sub-annotate by lineage markers |

## Epithelial / stromal / vascular

| Cell type | Markers |
|-----------|---------|
| Epithelial (general) | `EPCAM`, `KRT8`, `KRT18`, `KRT19` |
| Basal epithelial | `KRT5`, `KRT14`, `TP63` |
| Secretory / goblet | `MUC5AC`, `MUC2`, `TFF3` |
| Enterocytes | `FABP1`, `APOA1`, `VIL1` |
| Hepatocytes | `ALB`, `APOA2`, `TTR`, `CYP3A4` |
| Alveolar type 1 | `AGER`, `PDPN`, `CAV1` |
| Alveolar type 2 | `SFTPC`, `SFTPB`, `LAMP3` |
| Fibroblasts | `COL1A1`, `COL1A2`, `DCN`, `LUM`, `PDGFRA` |
| Myofibroblasts / CAF | `ACTA2`, `TAGLN`, `POSTN`, `FAP` |
| Pericytes | `RGS5`, `PDGFRB`, `MCAM`, `KCNJ8` |
| Smooth muscle | `MYH11`, `CNN1`, `DES` |
| Endothelial | `PECAM1`, `VWF`, `CDH5`, `CLDN5` |
| Lymphatic endothelial | `PROX1`, `LYVE1`, `PDPN` |
| Mesothelial | `MSLN`, `UPK3B`, `WT1` |

## Brain

| Cell type | Markers |
|-----------|---------|
| Excitatory neurons | `SLC17A7`, `SATB2`, `NRGN` |
| Inhibitory neurons | `GAD1`, `GAD2`, `SLC32A1` |
| Astrocytes | `GFAP`, `AQP4`, `SLC1A2`, `ALDH1L1` |
| Oligodendrocytes | `MBP`, `MOBP`, `PLP1`, `MOG` |
| OPC | `PDGFRA`, `VCAN`, `OLIG1` |
| Microglia | `CX3CR1`, `P2RY12`, `TMEM119`, `CSF1R` |
| Endothelial | `CLDN5`, `FLT1` |

## Quality flags worth plotting alongside

- `pct_counts_mt` high + low `n_genes` → dying cells, not a cell type.
- `PPBP`/`HBB` co-expression with immune markers → ambient RNA or doublets.
- Two lineage marker sets in one cluster (e.g. `CD3E` + `LYZ`) → doublet cluster; check the Scrublet score distribution for that cluster.
- A cluster defined only by ribosomal (`RPS*`/`RPL*`) or stress genes (`FOS`, `JUN`, `HSPA1A`) → dissociation/handling artefact; report, do not name as a cell type.
