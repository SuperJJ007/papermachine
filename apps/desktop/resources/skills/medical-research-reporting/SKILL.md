---
name: medical-research-reporting
description: "医学论文写作。按 EQUATOR 选指南（CONSORT 2025、STROBE、PRISMA、STARD、TRIPOD+AI）、自报清单、结构化摘要。触发: 报告规范、CONSORT清单、投稿、审稿意见回复。Use to write up results or check a reporting checklist. Coverage is self-reported, not certification."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
---

# Medical Research Reporting

Turn a finished PaperMachine analysis into manuscript text that satisfies an EQUATOR reporting guideline and a journal's statistical editor. This skill writes prose and checklists; it calls `run_python` only to pull numbers from session artifacts (via `artifact_inputs`) so every figure in the text traces back to a computed value.

## Workflow

1. **Identify the study type and guideline** with `references/guideline_selector.md`. Announce the guideline and version (e.g. "CONSORT 2025"; use `CONSORT_2010` only for historical manuscripts). Journals reject manuscripts without the checklist — produce it as self-reported coverage, then verify against the publisher PDF.
2. **Inventory what the session already computed** with `get_science_state`: Table 1, primary-outcome model, figures. Cite artifact names in the draft (e.g. "Figure 2 = `km_os.png` v2") so the user can trace each claim.
3. **Draft the structured abstract** (≤ 300 words; Background/Objective, Methods (design, setting, participants, intervention/exposure, main outcome), Results (n, primary effect with CI and p, key secondaries), Conclusions (one sentence, no over-reach), Registration). Use absolute and relative effects.
4. **Methods** — write in past tense, in this order: design & setting, participants & eligibility, intervention/exposure, outcomes (with time points and who assessed them), sample size, randomization/blinding or confounder control, statistical analysis (populations, models, covariates, missing data, multiplicity, software with versions from the artifact environment tab, two-sided α). Every statistical sentence must be checkable against the trace.
5. **Results** — follow the analysis order: flow → baseline → primary → secondary → subgroups/sensitivity → harms. Numbers: n (%), mean (SD), median (IQR), effect (95% CI), exact p to 2 significant digits (p = .03, p < .001). Never say "trend towards significance".
6. **Discussion** — principal finding (1 paragraph, no new numbers), comparison with prior evidence, mechanisms/plausibility, strengths and **limitations** (be specific: bias direction and magnitude), implications for practice/research, conclusion.
7. **Tables and figure legends** — self-explanatory; define every abbreviation; footnote the model and covariates; legends state what error bars are.
8. **Fill the checklist** (`references/checklists.md` has item lists) as a Markdown table with page/section pointers, written to `SCIENCE_ARTIFACT_DIR/reporting_checklist.md`. Items that cannot be satisfied are marked "Not reported — reason", never silently omitted.
9. **Reviewer responses** — quote each comment, respond point by point, cite the exact change and location, run new analyses in the session when asked and reference the new artifact versions.

## Style Rules (ICMJE / AMA)

- Report effect sizes with CIs before p-values; do not report p-values alone.
- Use "associated with" for observational studies; reserve causal verbs for randomized evidence.
- No "significant" without a statistical referent; avoid "marginally significant".
- Numbers < 10 spelled out only when not paired with a unit; percentages with one decimal when n < 100 is not sensible.
- Abbreviations: define at first use in abstract and again in text.
- Software: "Analyses were performed with Python 3.13 (statsmodels 0.14.6, lifelines 0.29) and R 4.5 (survival 3.7)". Pull versions from the artifact environment tab.
- Data-sharing, ethics approval number, consent, registration and funding/COI statements are mandatory sections.

## Resources

- `references/guideline_selector.md` — design → guideline map with extensions.
- `references/checklists.md` — condensed CONSORT 2025 (plus historical 2010), STROBE, PRISMA 2020, STARD, TRIPOD+AI, ARRIVE, CARE item lists.
- `references/abstract_templates.md` — structured abstract templates per study type and journal.

## Release candidate execution notes

Before any patient row preview, run the PHI package's `scripts/phi_preflight.py` locally and return only its summary. Do not paste raw patient previews into `phi_scan`; no-match is not privacy clearance. Use synthetic or approved de-identified data.
For `reporting_checklist`, provide a stable `manuscript_id` and structured `reviews` entries with explicit status and note. Use `not_reported` for missing items, `not_applicable` with justification, and `needs_review` after manuscript changes. Only `reported` contributes to coverage; old free-text `completed` records require re-review. Coverage is self-reported, not certification.
