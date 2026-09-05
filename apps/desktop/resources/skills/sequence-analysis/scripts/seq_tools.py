"""Small, dependency-light sequence helpers on top of Biopython.

    exec(open(f"{SKILL_DIR}/scripts/seq_tools.py").read())
    orfs = find_orfs(seq, min_aa=100, table=1)
    rep  = primer_report({"F": "ACGT...", "R": "TTGA..."}, template=seq)
    rscu = codon_usage(cds_seq)
    ident = pairwise_identity(seq_a, seq_b, kind="dna")
"""
from __future__ import annotations

import re
from collections import Counter

import pandas as pd
from Bio.Seq import Seq
from Bio.Align import PairwiseAligner, substitution_matrices
from Bio.Data import CodonTable
from Bio.SeqUtils import gc_fraction, MeltingTemp as mt


def find_orfs(seq, min_aa: int = 100, table: int = 1, start_codons=("ATG",)) -> pd.DataFrame:
    """All ORFs (start codon → in-frame stop) on both strands in the six frames.
    Coordinates are 1-based, inclusive, on the forward strand. `length_nt` includes the stop."""
    seq = Seq(str(seq).upper())
    n = len(seq)
    stops = set(CodonTable.unambiguous_dna_by_id[table].stop_codons)
    rows = []
    for strand, s in ((+1, seq), (-1, seq.reverse_complement())):
        for frame in range(3):
            i = frame
            while i + 3 <= n:
                codon = str(s[i:i + 3])
                if codon in start_codons:
                    j = i
                    while j + 3 <= n and str(s[j:j + 3]) not in stops:
                        j += 3
                    if j + 3 <= n:                      # found a stop
                        length = j + 3 - i
                        if length // 3 - 1 >= min_aa:
                            if strand == 1:
                                start, end = i + 1, j + 3
                            else:
                                start, end = n - (j + 3) + 1, n - i
                            prot = str(s[i:j + 3].translate(table=table))
                            rows.append(dict(frame=frame + 1, strand="+" if strand == 1 else "-", start=start, end=end,
                                             length_nt=length, length_aa=length // 3 - 1, protein=prot.rstrip("*")))
                        i = j + 3                       # continue after this ORF
                        continue
                i += 3
    return pd.DataFrame(rows).sort_values(["length_nt"], ascending=False).reset_index(drop=True) if rows else \
        pd.DataFrame(columns=["frame", "strand", "start", "end", "length_nt", "length_aa", "protein"])


def _self_dimer_score(p: str) -> float:
    aligner = PairwiseAligner(mode="local", match_score=1, mismatch_score=-1, open_gap_score=-2, extend_gap_score=-1)
    return aligner.score(p, str(Seq(p).reverse_complement()))


def _hairpin(p: str, stem: int = 4) -> bool:
    rc = str(Seq(p).reverse_complement())
    return any(p[i:i + stem] in rc[:len(rc) - i - stem] for i in range(len(p) - 2 * stem - 3))


def primer_report(primers: dict[str, str], template=None) -> pd.DataFrame:
    """Rule-based primer QC. Columns: name, seq, length, gc_pct, tm_c, runs, gc_clamp, self_dimer,
    hairpin, template_hits_fwd, template_hits_rev, flags (semicolon list of failed rules)."""
    rows = []
    tms = {}
    for name, p in primers.items():
        p = p.upper().replace(" ", "")
        gc = gc_fraction(p) * 100
        tm = mt.Tm_NN(p, Na=50, dnac1=250, dnac2=0)
        tms[name] = tm
        runs = max((len(m.group(0)) for m in re.finditer(r"(A+|C+|G+|T+)", p)), default=0)
        clamp = sum(1 for b in p[-5:] if b in "GC")
        sd = _self_dimer_score(p)
        hp = _hairpin(p)
        flags = []
        if not 18 <= len(p) <= 25: flags.append("length")
        if not 40 <= gc <= 60: flags.append("GC%")
        if not 55 <= tm <= 65: flags.append("Tm")
        if runs >= 4: flags.append("run>=4")
        if clamp == 0 or clamp > 3: flags.append("3'clamp")
        if sd >= 8: flags.append("self-dimer")
        if hp: flags.append("hairpin")
        hits_f = hits_r = None
        if template is not None:
            t = str(template).upper()
            hits_f = t.count(p)
            hits_r = t.count(str(Seq(p).reverse_complement()))
            if hits_f + hits_r != 1: flags.append("template-hits!=1")
        rows.append(dict(name=name, seq=p, length=len(p), gc_pct=round(gc, 1), tm_c=round(tm, 1), runs=runs,
                         gc_clamp=clamp, self_dimer=sd, hairpin=hp, template_hits_fwd=hits_f, template_hits_rev=hits_r,
                         flags=";".join(flags)))
    df = pd.DataFrame(rows)
    if len(tms) == 2:
        a, b = tms.values()
        if abs(a - b) > 3:
            df["flags"] = df["flags"].apply(lambda f: ";".join([x for x in [f, "pair-dTm>3"] if x]))
    return df


def codon_usage(cds, table: int = 1) -> pd.DataFrame:
    """Codon counts, frequency per thousand, and RSCU for an in-frame CDS."""
    s = str(cds).upper()
    s = s[: len(s) // 3 * 3]
    codons = [s[i:i + 3] for i in range(0, len(s), 3)]
    counts = Counter(c for c in codons if set(c) <= set("ACGT"))
    fwd = CodonTable.unambiguous_dna_by_id[table].forward_table
    aa_of = dict(fwd)
    for stop in CodonTable.unambiguous_dna_by_id[table].stop_codons:
        aa_of[stop] = "*"
    rows = []
    total = sum(counts.values())
    by_aa = {}
    for c, aa in aa_of.items():
        by_aa.setdefault(aa, []).append(c)
    for aa, syn in sorted(by_aa.items()):
        tot_aa = sum(counts[c] for c in syn)
        for c in sorted(syn):
            n = counts[c]
            rscu = (n * len(syn) / tot_aa) if tot_aa else float("nan")
            rows.append(dict(amino_acid=aa, codon=c, count=n, per_thousand=round(1000 * n / total, 2) if total else 0,
                             rscu=round(rscu, 3)))
    return pd.DataFrame(rows)


def pairwise_identity(a, b, kind: str = "dna") -> dict:
    """Global alignment with stated parameters; returns score, identity over aligned columns
    (gaps excluded), identity over the shorter sequence, alignment length, gaps, and the alignment text."""
    aligner = PairwiseAligner(mode="global")
    if kind == "protein":
        aligner.substitution_matrix = substitution_matrices.load("BLOSUM62")
        aligner.open_gap_score, aligner.extend_gap_score = -10, -0.5
        params = "BLOSUM62, gap open -10, extend -0.5"
    else:
        aligner.match_score, aligner.mismatch_score = 2, -1
        aligner.open_gap_score, aligner.extend_gap_score = -2, -0.5
        params = "match 2, mismatch -1, gap open -2, extend -0.5"
    aln = aligner.align(str(a), str(b))[0]
    cols = aln.counts()             # identities, mismatches, gaps (Biopython >= 1.80)
    aligned_cols = cols.identities + cols.mismatches
    return dict(score=aln.score, parameters=params, alignment_length=aln.length, gaps=cols.gaps,
                identity_aligned_pct=round(100 * cols.identities / aligned_cols, 2) if aligned_cols else 0.0,
                identity_shorter_pct=round(100 * cols.identities / min(len(a), len(b)), 2),
                alignment=str(aln))
