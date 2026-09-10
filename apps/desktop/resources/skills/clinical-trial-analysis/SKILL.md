---
name: clinical-trial-analysis
description: "临床试验 / RCT。CONSORT 2025 流程、基线 Table 1（SMD）、ITT/PP、ANCOVA/logistic。触发: 随机对照、基线表、主要终点、意向性分析、亚组、不良事件。Use for randomized trial data with treatment arms, endpoints, ITT, or Table 1. MMRM means unstructured residual covariance in R mmrm, not MixedLM random slopes."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
  reporting-guideline: CONSORT 2025
---

# Clinical Trial Analysis

Analyze randomized controlled trials through `run_python` (preferred) or `run_r`, producing a result set a biostatistical reviewer and a journal editor can both accept: a CONSORT participant flow, a baseline Table 1, a pre-specified primary analysis with the correct estimand, and honest secondary/subgroup analyses with multiplicity control.

## Installation

Install through `install_science_packages`, not shell `pip`: Python `pingouin>=0.6`, `statsmodels>=0.14.6`, `scipy>=1.11`, `tableone`, `lifelines` (if time-to-event endpoints), `forestplot`. R: `r-tableone`, `r-gtsummary`, `r-emmeans`, `r-lme4`, `r-survival`, `r-forestplot`.

`scripts/table_one.py` needs only pandas/scipy and works without `tableone`.

## Workflow

Work through every step and say what you did — trial analyses get audited.

1. **Reconstruct the design before touching outcomes.** Identify: arms and allocation ratio, randomization unit (individual/cluster), stratification factors, primary endpoint and its type (continuous / binary / time-to-event / count), pre-specified analysis population (ITT, mITT, PP, safety), superiority vs non-inferiority and the margin. Write these down as a **Statistical Analysis Plan (SAP) summary** in your reply *before* computing any treatment effect. If the user cannot supply one, state your assumptions explicitly and mark the analysis as post-hoc.
2. **CONSORT flow.** Count screened → randomized → allocated → received intervention → followed up → analyzed, per arm, with reasons for exclusion/loss. Use `scripts/consort_flow.py` to compute counts and render a CONSORT diagram PNG (declare it in `raster_artifacts`).
3. **Baseline Table 1.** Use `scripts/table_one.py` — continuous: mean (SD) or median [IQR] depending on distribution; categorical: n (%). Report **standardized mean differences (SMD)**, not p-values, for baseline balance in an RCT (CONSORT discourages baseline significance tests; randomization guarantees balance in expectation). Flag any |SMD| > 0.1.
4. **Define the analysis populations** as explicit boolean columns (`itt`, `pp`, `safety`) and print their sizes per arm. ITT = as randomized, regardless of adherence. Primary analysis on ITT for superiority; PP is co-primary for non-inferiority.
5. **Primary endpoint analysis** — pick by endpoint type (`references/endpoint_models.md`):
   - Continuous change from baseline → **ANCOVA** adjusting for baseline value and stratification factors (never a t-test on change scores when baseline is available).
   - Binary → logistic regression adjusted for stratification factors; report risk difference and NNT with CI (`scripts/binary_effects.py`) alongside the OR.
   - Repeated measures → **MMRM with unstructured residual covariance**, visit × arm interaction, LS-means at the primary visit. Use R `mmrm::mmrm(y ~ arm * visit + y_base + us(visit | id))`. `statsmodels MixedLM` / `lme4::lmer` with random intercept+slope is **not** unstructured residual MMRM — do not report it as such.
   - Time-to-event → load the `survival-analysis` skill.
   - Count/rate → negative binomial with log(exposure) offset.
   Report point estimate, 95% CI, exact p, and the estimand (treatment policy / hypothetical / while-on-treatment).
6. **Missing data.** Report missingness per arm and visit. Primary: MMRM (MAR) or multiple imputation; **never LOCF as primary**. Run at least one sensitivity analysis (tipping-point or jump-to-reference) when missingness > 5% and say how conclusions change.
7. **Secondary endpoints & multiplicity.** List the pre-specified hierarchy. Apply the family-wise strategy the SAP names (hierarchical gatekeeping, Holm, Hochberg); label everything else exploratory.
8. **Subgroup analysis.** Use `scripts/subgroup_forest.py`: estimate within each pre-specified subgroup, test the **interaction** term, and draw a forest plot. Interpret only the interaction p-value; a significant effect inside one subgroup and not another is *not* evidence of heterogeneity.
9. **Safety.** Adverse events by arm: any AE, serious AE, AE leading to discontinuation, and by MedDRA system organ class/preferred term with n (%) — descriptive, no p-values unless pre-specified.
10. **Report** with `references/consort_reporting.md`: the Table 1, the primary result sentence, CONSORT items covered, and limitations.

If the user asks for one piece (e.g. "just give me Table 1"), do that step but still confirm the arm variable and the population it describes.

## Key Rules

- **Do not test baseline balance with p-values in an RCT.** Use SMD.
- **Adjust for what you stratified on.** Ignoring stratification factors inflates the SE.
- **Change from baseline ≠ ANCOVA.** ANCOVA is more efficient and unbiased under randomization.
- **Non-inferiority:** the conclusion comes from the CI versus the margin, not from p > 0.05. Report both ITT and PP; they must agree.
- **Interim analyses** consume alpha; if the trial had them, ask which spending function was used before reporting a final p.
- **Cluster randomization** requires a mixed model or GEE with the cluster as a random effect; the ICC must be reported.
- Keep the analysis population, endpoint definition, and model formula printed in the run output so the trace shows them.

## Reporting Template

> Among N randomized participants (n₁ in arm A, n₂ in arm B), the primary endpoint [name] at [time] was [estimate] in A versus [estimate] in B (adjusted difference/OR/HR = X; 95% CI, L to U; P = .xxx). Analysis was by intention-to-treat, adjusted for [stratification factors] with [model]. [n] participants (x%) had missing primary-endpoint data; results were consistent under [sensitivity method].

Effect sizes, CIs and exact p-values always; state the population and the model in the same sentence.

## Resources

- `scripts/table_one.py` — Table 1 generator with SMD, writes CSV + Markdown.
- `scripts/consort_flow.py` — CONSORT counts and diagram (matplotlib).
- `scripts/binary_effects.py` — risk difference, RR, OR, NNT with CIs (Wald/Newcombe).
- `scripts/subgroup_forest.py` — subgroup estimates, interaction tests and forest plot.
- `references/endpoint_models.md` — model choice per endpoint type with statsmodels/R code.
- `references/consort_reporting.md` — CONSORT 2025 items mapped to analysis outputs (2010 kept as historical).

## Release candidate execution notes

Before any patient row preview, run the PHI package's `scripts/phi_preflight.py` locally and return only its summary. Do not paste raw patient previews into `phi_scan`; no-match is not privacy clearance. Use synthetic or approved de-identified data.
SMD `inf` indicates complete separation and `nan` means insufficient data; neither is balanced. Review missingness explicitly. In propensity matching, each treated subject and all retained controls share one `pair` ID; only complete 1:k sets are retained, without replacement. Report unmatched subjects and attrition.
