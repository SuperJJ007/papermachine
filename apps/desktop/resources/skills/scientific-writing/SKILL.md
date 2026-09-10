---
name: scientific-writing
description: "Draft, revise, and audit scientific manuscripts with evidence provenance, reporting-guideline coverage, authorship accountability, confidentiality controls, and consistency checks — sections, references, declarations, tables, submission prep. Trigger terms: 论文写作、润色、摘要、投稿、科研写作、文献综述."
license: MIT
compatibility: Platform-neutral. Bundled CLIs are offline/dependency-free; run through `run_python`, not a shell.
metadata:
  version: "2.0"
  skill-author: K-Dense Inc.
---

# Scientific Writing

Produce clear scientific prose without inventing evidence or concealing uncertainty. Keep drafting, evidence verification, and submission approval as separate stages. Accountable human authors control scientific decisions and final approval; AI is not an author, and fluency is never evidence.

## Non-negotiable safety rules

- **Confidentiality**: never send unpublished manuscripts, peer-review material, sensitive/restricted data, PHI, or proprietary source documents externally without explicit authorization and a documented policy review. When unclear, stay local with minimum metadata; de-identification needs expert review, not just name removal. See `references/authorship_ai_confidentiality.md`.
- **No fabrication**: never invent citations/DOIs/quotations, results/effect estimates/significance, methods/protocol details, registrations/consent, authors/CRediT roles, or funding/conflicts/AI-disclosure statements. State missing/unverified/not-applicable, not plausible boilerplate.
- **Evidence binding**: every factual/numeric claim maps to a verified evidence ID a human opened, confirmed, and recorded who/when. Search snippets, summaries, and another work's bibliography aid discovery but never verify a claim. See `references/evidence_workflow.md`.
- **Scientific fidelity**: preserve uncertainty and alternatives; distinguish confirmatory/exploratory/post hoc work; keep methods and results consistent; reconcile units/denominators/sample sizes/labels; report negative/null/inconclusive findings; state concrete limitations; never treat association as causation or non-significance as equivalence.

## Intake

Before drafting, obtain or explicitly mark unresolved: document type/design/stage/audience/venue; author instructions and policy date; protocol/registration/analysis plan/guideline; section scope; verified source manifest and claim registry; methods/results/tables/figures/supplements; authorship/CRediT/declarations; confidentiality classification; data/code/repository constraints. Skip restricted material when metadata or a local audit already suffices.

## Workflow

Run every bundled script through `run_python`, not a shell; flags for each are in `references/cli_reference.md`.

1. **Establish the local workspace.** Optionally scaffold fail-closed Markdown/JSON/CSV drafts with `scaffold_manuscript.py` (never overwrites; output is not submission-ready, and the linter rejects its placeholders).
2. **Select reporting guidance** with `select_reporting_guidelines.py select`, by actual design/article type, then open the current official statement/checklist/extensions/journal instructions. Non-scoring: does not certify quality, compliance, or acceptance. See `references/reporting_guidelines.md`.
3. **Build the evidence record**: `E` IDs for sources (`source_manifest.json`), `C` IDs for claims (`claims.csv`, a hash of claim text, not raw text), `N`/`M`/`O`/`R` IDs for numeric facts/methods/outcomes/results (`consistency_manifest.json`); annotate drafts `[claim:C001] [evidence:E001,E002]`. A source is verified only once a human opened it and confirmed the exact support.
4. **Create an evidence outline** from recorded evidence only: objective, section purpose, claim/evidence/methods/result IDs, analysis intent/uncertainty, unresolved conflicts, reporting topics. Unsupported content stays in an unresolved-issues list, not manuscript prose.
5. **Draft without adding facts.** Match title/abstract to the completed text; describe methods as performed; present results in the declared order/population; separate result from interpretation unless the venue combines them; compare with prior evidence only after verifying it; keep conclusions within the observed design/uncertainty. IMRAD only when it fits — `references/imrad_structure.md`, `references/writing_principles.md`.
6. **Reconcile methods and results**: record repeated numeric facts and method-result mappings, run `check_consistency.py`, and resolve every mismatch manually — name any legitimate analysis-set difference instead of silently normalizing it.
7. **Verify citations and claims** with `validate_manifest.py --kind source --require-verified`, `audit_claims.py`, `check_references.py` (syntax/duplicate-ID only, no network resolution). A human still compares every identifier/quotation with the opened source, per NLM *Citing Medicine* or the venue's style.
8. **Validate authorship and disclosure.** Use journal criteria for authorship; record CRediT roles as metadata (CRediT does not define authorship). AI use needs human verification of affected content and disclosure per current policy; run `validate_authorship.py`, never from assumptions. See `references/authorship_ai_confidentiality.md`.
9. **Review declarations independently**: ethics/consent, registration, funding, conflicts, contributions, data/code availability, AI use. Be as open as rights permit without exposing confidential/proprietary information; record actual access conditions. See `references/research_integrity_open_science.md`.
10. **Use figures/tables only when warranted** (this skill does not generate images). Link source data/code/evidence IDs; reconcile values with prose; document processing/permissions; include units/sample sizes/uncertainty; provide alt text and non-color cues; check accessibility at final size. See `references/figures_tables.md`.
11. **Record non-scoring guideline coverage** with `select_reporting_guidelines.py check`, then complete the official checklist against actual manuscript locations — never claim adherence merely because the coverage file passes.
12. **Lint and approve** with `validate_manifest.py --kind manuscript` and `lint_manuscript.py` (issue codes/line numbers, no text echo; sensitive-content warnings need manual review, not a de-identification certificate). Only accountable humans resolve ambiguities, approve author order/disclosure, set `submission_ready` true, remove the draft banner, or authorize submission.

## Revision and peer review

Treat reviewer material as confidential; never upload it externally without authorization and policy review. Per change: record it inside the approved boundary; classify editorial/scientific/statistical/policy/unresolved; identify affected claims/evidence/methods/results; revise registries before prose when facts change; re-run every affected audit; draft a response stating what changed and where; get human approval. Never comply with a request that would fabricate, hide, overstate, or breach policy.

## Current policy caution

COPE's 2017 Core Practices were retired in 2024; a replacement Code is pending. Never describe the archived Core Practices as current membership standards; distinguish formal COPE positions from discussion documents, webinars, and case advice. See `references/source_ledger.md`.

## Formatting and submission

Use the Markdown scaffold and structured records; apply the venue's controlled template only after verification. Formatting cannot convert an incomplete evidence record into a submission-ready paper. See `references/professional_report_formatting.md`, `references/journal_policies.md`.

## Bundled files

`assets/` holds the manifest/scaffold templates named above; every `scripts/` entry above is local, deterministic, bounded, dependency-free, network-free — flags in `references/cli_reference.md`. `references/` also has `citation_styles.md` and `source_ledger.md`.
