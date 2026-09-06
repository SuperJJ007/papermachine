# Phylogenetics — model choice, rooting, and honest reading of a tree

## Before building anything

- **Alignment quality decides the tree.** Inspect it: print columns with > 50 % gaps, check that protein-coding DNA is aligned in frame (align translated sequences, back-translate if needed), and consider trimming poorly aligned ends. Report alignment length and the fraction of gap columns.
- **Orthologs, not paralogs.** A gene tree with mixed paralogs is not a species tree. Say what the tree represents.
- **Enough signal?** Fewer than ~300 informative sites rarely resolve deep nodes; low bootstrap values are the expected honest result.

## Substitution models

| Data | Quick distance | ML candidates | Notes |
|------|----------------|---------------|-------|
| DNA, closely related | K80 / TN93 distance, NJ | HKY+G, GTR+G(+I) | `modelTest` picks by BIC; `+I` with `+G` is often over-parameterized — prefer `+G` alone when BIC is close |
| DNA, coding | as above, or codon-position partitions | GTR+G | State whether 3rd positions were included |
| Protein | JTT / LG distance | LG+G, WAG+G, JTT+G | LG is the usual best; `+F` (empirical frequencies) when alignment is long |
| 16S rRNA / ITS | TN93 | GTR+G | Trim to a common region first |

Report: model, why (BIC), and the tool/version (`packageVersion("phangorn")`).

## Methods and what they claim

- **NJ**: fast, distance-based, no explicit optimality; fine for a first look and for > 500 taxa. Never the only tree in a paper figure.
- **Maximum likelihood** (`optim.pml`, or IQ-TREE/RAxML if installed via bioconda): the standard reported tree; bootstrap ≥ 100 (≥ 1000 with UFBoot in IQ-TREE).
- **Bayesian** (MrBayes/BEAST): posterior probabilities, divergence times — outside this environment; say so if asked.

## Rooting

An unrooted ML tree has no direction of time. Root with a **named outgroup** the user justifies (a taxon known to be outside the ingroup), or **midpoint** only when rates are approximately clock-like and no outgroup exists — and label the figure accordingly. Rooting choice changes which groups are monophyletic; report it explicitly.

## Reading the tree

- Bootstrap ≥ 70 % (ML) is conventional "support"; < 50 % nodes should be shown as unresolved (collapse with `ape::di2multi` after setting low-support branch lengths to 0, or just say the node is unsupported).
- Branch lengths are substitutions per site, not time. Similar-looking clades at different depths are not "equally old".
- Ladder-like topologies with short internal branches indicate rapid radiation or insufficient signal — not a confident order of divergence.
- A single sequence on a long branch may be a misaligned or contaminated sequence (long-branch attraction); check its alignment before interpreting.

## Tree figure checklist

Tip labels legible (≤ ~60 tips per figure; otherwise collapse clades), bootstrap values on nodes ≥ 70, scale bar, outgroup at the bottom or top, model and replicate count in the title or caption, and the Newick file delivered alongside (`tree_ml.nwk`) so the tree is reusable.

## Useful ape / phangorn calls

```r
tr <- read.tree("tree_ml.nwk")
tr <- ladderize(tr)                                     # tidy plotting order
is.monophyletic(tr, tips = c("A", "B", "C"))
cophenetic(tr)["A", "B"]                                # patristic distance
drop.tip(tr, "Contaminant_sample")
dist.topo(tr_ml, tr_nj)                                 # Robinson–Foulds distance between methods
```
