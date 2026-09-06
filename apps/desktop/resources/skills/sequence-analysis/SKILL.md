---
name: sequence-analysis
description: "DNA/RNA/protein sequence work with Biopython (Python, shipped) and ape/phangorn (R, shipped) — FASTA/FASTQ/GenBank parsing, GC content and sliding windows, transcription/translation, ORF finding, reverse complement, restriction sites, primer property checks, motif search, pairwise and multiple alignment, identity/similarity, codon usage, protein physicochemical properties, distance-based and maximum-likelihood phylogenetic trees with bootstrap, and tree plotting. Use whenever a user shares a sequence, a FASTA/GenBank file, an alignment, or asks about primers, ORFs, mutations, conservation, or a phylogeny. Trigger terms: 序列、FASTA、GenBank、比对、引物、翻译、ORF、GC 含量、酶切位点、突变、保守性、系统发育树、进化树、Biopython."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Sequence Analysis

Handle sequence files and questions through `run_python` (Biopython) and `run_r` (ape, phangorn), writing tables and figures to `SCIENCE_ARTIFACT_DIR`. The workspace is read-only for the model — sequences arrive via `SCIENCE_WORKSPACE_DIR` paths or pasted text — and there is no shell, so external aligners (BLAST, MAFFT, MUSCLE) are not available unless installed as conda packages and driven through `subprocess` **from inside the kernel**. Prefer pure-Python/R methods first; reach for external binaries only for multiple alignment of many sequences, and say when a result would normally come from BLAST against a live database.

## Installation

Shipped in the `biology` environment: `biopython` (`Bio`), `r-ape`, `r-phangorn`. Extras through `install_science_packages`:

| Need | Language | Spec | Platform note |
|------|----------|------|---------------|
| Multiple sequence alignment binary | python | `mafft` or `muscle` (bioconda) | macOS only; on Windows use `Bio.Align.PairwiseAligner` progressively or ask for a pre-aligned file |
| Fast local alignment / database search | python | `blast` (bioconda) | macOS only; needs a local database the user provides |
| Primer design | python | `primer3-py` | conda-forge, all platforms |
| Reading BAM/SAM/VCF | python | `pysam` (bioconda, macOS) / `cyvcf2` | Windows: parse text VCF with pandas |
| Protein structure files | python | `biopython` already reads PDB/mmCIF (`Bio.PDB`) | |
| Tree plotting in R with annotations | r | `bioconductor-ggtree` (macOS) | Fallback: `ape::plot.phylo` |

Compatibility traps: `Bio.pairwise2` is deprecated — use `Bio.Align.PairwiseAligner`. `Bio.SeqUtils.GC` was renamed to `gc_fraction` (returns 0–1). `Seq.translate()` on a length not divisible by 3 warns; slice to `len // 3 * 3` explicitly. `SeqIO.parse` returns a generator — wrap in `list()` before re-using.

## Workflow

1. **Identify what was given.** Format (FASTA, FASTQ, GenBank, EMBL, raw text), alphabet (DNA/RNA/protein — infer from composition and confirm), count, lengths, and any ambiguity codes (`N`, `R`, `Y`). Print a summary table (`id, length, GC, N-fraction`). For GenBank, list features (`CDS`, `gene`, `exon`) with coordinates and strand.
2. **Answer the concrete question with the smallest correct tool** — see the recipe list below. Print intermediate values (positions are **1-based** in reports, 0-based in code; say which every time).
3. **Alignment.** Two sequences: `PairwiseAligner` with a named scoring scheme (`mode="global"`, `substitution_matrix=substitution_matrices.load("BLOSUM62")` for protein; `match_score=2, mismatch_score=-1, open_gap_score=-2, extend_gap_score=-0.5` for nucleotides). Report score, identity (%) computed over aligned columns excluding gaps **and** over the shorter sequence length, and print the alignment in blocks. Many sequences: MAFFT/MUSCLE via `subprocess.run([...], capture_output=True, text=True, check=True)` from the kernel, output to the scratch directory, then parse with `AlignIO`. Always state the aligner and parameters.
4. **Variants and conservation.** From an alignment, compute per-column conservation (Shannon entropy or fraction identical to reference) and list differences against a named reference as `ref_pos ref_base alt_base` (protein: `p.Ala123Thr` style); for a CDS, translate both and classify synonymous / missense / nonsense / frameshift. Plot conservation along the sequence as a matplotlib line/bar figure.
5. **Phylogeny.** In R: read the alignment (`ape::read.dna` / `phangorn::read.phyDat`), choose a model (`modelTest` for ML; `dist.dna(model="K80")` or `"TN93"` for distance), build NJ (`nj`) for a quick tree and ML (`pml` → `optim.pml`) for the reported one, bootstrap (`bootstrap.pml` or `boot.phylo`, ≥ 100 replicates, `set.seed(1)`), root on a stated outgroup or midpoint (`phangorn::midpoint`), and plot with `plot.phylo` + `nodelabels` for bootstrap ≥ 70. Save the tree as Newick (`write.tree`) to `SCIENCE_ARTIFACT_DIR/tree.nwk` and the figure via `png()`/`dev.off()` or `ggsave` (declared in `raster_artifacts`). `scripts/phylo_pipeline.R` runs distance + ML + bootstrap in one call.
6. **Deliver.** Tables as CSV (`orfs.csv`, `primers.csv`, `variants.csv`), sequences as FASTA (`SeqIO.write(records, path, "fasta")` — FASTA is not auto-captured; write it under `SCIENCE_ARTIFACT_DIR` and also print it in the reply when short), figures as PNG. Use `annotate_artifact` on the main figure or table.

## Recipes (Biopython)

```python
from Bio import SeqIO, Align
from Bio.Seq import Seq
from Bio.SeqUtils import gc_fraction, MeltingTemp as mt, molecular_weight
from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio.Align import substitution_matrices
from Bio.Restriction import RestrictionBatch, Analysis

recs = list(SeqIO.parse(path, "fasta"))                     # or "genbank", "fastq"
s = recs[0].seq
gc = gc_fraction(s) * 100                                    # percent
rc = s.reverse_complement()
prot = s[: len(s) // 3 * 3].translate(table=1, to_stop=False)  # table=11 for bacteria, 2 for vertebrate mito
```

- **Sliding-window GC**: `[gc_fraction(s[i:i+w]) for i in range(0, len(s)-w+1, step)]`; plot vs midpoint.
- **ORFs** (all six frames, ATG→stop, min length): `scripts/seq_tools.py::find_orfs(seq, min_aa=100, table=1)` returns a DataFrame `frame, strand, start, end, length_nt, protein`.
- **Restriction sites**: `Analysis(RestrictionBatch(["EcoRI","BamHI","HindIII"]), s, linear=True).full()` → dict enzyme → cut positions; `RestrictionBatch(first=[], suppliers=["N"])` for a commercial set.
- **Primer check**: length 18–25, GC 40–60 %, Tm 55–65 °C (`mt.Tm_NN(primer, Na=50, dnac1=250, dnac2=0)`), ΔTm between pair ≤ 3 °C, no runs ≥ 4 identical bases, 3′ GC clamp (1–2 G/C in last 5), self-complementarity via `PairwiseAligner` local score of primer vs its reverse complement; `scripts/seq_tools.py::primer_report`. Design new primers with `primer3-py` if installed; otherwise scan candidates with the same rules.
- **Motif search** (IUPAC allowed): `Bio.SeqUtils.nt_search(str(s), "GGATCC")` → `[pattern, pos1, pos2, ...]` (0-based); regex with `Bio.Seq` translated IUPAC codes for degenerate motifs.
- **Codon usage**: count codons in-frame from CDS features → RSCU table; `scripts/seq_tools.py::codon_usage`.
- **Protein properties**: `ProteinAnalysis(str(prot)).molecular_weight()`, `.isoelectric_point()`, `.gravy()`, `.instability_index()`, `.secondary_structure_fraction()`; strip `*` first.
- **FASTQ quality**: `rec.letter_annotations["phred_quality"]` → per-position mean Phred plot; report % reads with mean Q ≥ 30.
- **GenBank feature extraction**: `[f for f in rec.features if f.type == "CDS"]`, `f.location.extract(rec.seq)`, `f.qualifiers.get("gene", ["?"])[0]`.

## Integrity rules

1. **State the genetic code table and the coordinate convention** in every result.
2. **An alignment identity without the aligner and parameters is meaningless**; report both, plus alignment length and gap count.
3. **Never present a pure-Python pairwise alignment as a BLAST result** or invent E-values; if a database search is needed, say it requires BLAST against a named database.
4. **Bootstrap values are support for clades, not probabilities of the tree**; do not report a phylogeny without them or without the substitution model.
5. **Do not silently trim, reverse-complement, or "fix" a user's sequence** — do it explicitly and print what changed.
6. **Ambiguity codes and lowercase (soft-masked) bases** are reported, not dropped.

Files: `scripts/seq_tools.py` (`find_orfs`, `primer_report`, `codon_usage`, `pairwise_identity`), `scripts/phylo_pipeline.R` (`build_trees(alignment_path, outgroup, out_dir)`), `references/phylogenetics.md` (model choice, rooting, reading a tree honestly).
