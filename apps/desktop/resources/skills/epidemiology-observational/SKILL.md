---
name: epidemiology-observational
description: "观察性流行病学。队列/病例对照/横断面、发病率、RR/OR、混杂、标准化率、STROBE。触发: 队列研究、相对危险度、比值比、真实世界。Use for registry/EHR cohorts and risk-factor studies."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
  reporting-guideline: STROBE
---

# Observational Epidemiology

Estimate exposure–outcome associations from observational data with explicit handling of confounding, selection and information bias, through `run_python` (`statsmodels`, `scripts/epi_measures.py`) or `run_r` (`epiR`, `epitools`, `survival`).

## Installation

Base environment suffices. Optional: R `r-epir`, `r-epitools`, `r-dagitty`; Python `dowhy` for causal graphs.

## Workflow

1. **Name the design and the target estimand.** Cohort (risk/rate), case-control (odds ratio only — the OR approximates the RR when the outcome is rare or with incidence-density sampling), cross-sectional (prevalence ratio via log-binomial/Poisson-robust rather than OR). Say what time zero is and how exposure was measured.
2. **Draw the DAG** (text form is fine) listing exposure, outcome, confounders, mediators, colliders. Adjust for the **minimal sufficient adjustment set**; do **not** adjust for mediators or colliders (`references/confounding_and_dags.md`). State the set in the reply before fitting.
3. **Crude measures** with `scripts/epi_measures.py`: 2×2 table, RR/OR/RD with CIs; incidence rates with person-time and exact Poisson CIs; attributable fraction. For rates, verify person-time is computed from entry to event/censoring, not calendar years.
4. **Stratified analysis** (`epi_measures.py::mantel_haenszel`): stratum-specific estimates, MH-pooled estimate, Breslow-Day test for homogeneity. A crude–adjusted change ≥ 10% indicates confounding; heterogeneous strata indicate effect modification — report them separately, do not pool.
5. **Regression.** Binary: logistic (OR); for common outcomes in cohorts, log-binomial or modified Poisson with robust SE for RR. Rates: Poisson with `offset(log(person_time))`, negative binomial if over-dispersed. Time-to-event: Cox (load `survival-analysis`). Report the adjusted measure, CI, the covariate set and the model. Check EPV ≥ 10.
6. **Interaction.** Test multiplicative interaction (product term) *and* additive interaction (RERI, AP, S from `epi_measures.py::additive_interaction`); the additive scale is what matters for public health.
7. **Bias analysis.** E-value for the point estimate and CI bound (`epi_measures.py::e_value`); discuss selection (loss to follow-up, healthy-worker), information (misclassification direction), immortal-time and reverse-causation.
8. **Standardization** when comparing populations: direct age-standardized rates against a reference (`epi_measures.py::direct_standardize`) or SMR (indirect) with CI.
9. **Report** per STROBE (`references/strobe_checklist.md`): participants flow, descriptives, unadjusted and adjusted estimates with the confounders named, sensitivity analyses.

## Key Rules

- "Adjusted for everything available" is not a method. Justify each covariate with the DAG.
- Odds ratios overstate relative risk when the outcome is common (> 10%); use RR/PR in cohorts and cross-sectional studies.
- Report absolute measures (risk difference, NNH, rate difference) alongside relative ones.
- Never turn a p-value into causal language. "Associated with" unless the design supports more.
- Handle missing covariate data with multiple imputation; report the fraction missing per variable.

## Resources

- `scripts/epi_measures.py` — 2×2 measures, rates with person-time, MH stratified analysis, additive interaction (RERI), E-value, direct standardization.
- `references/confounding_and_dags.md` — adjustment-set rules, mediator/collider traps, negative controls.
- `references/strobe_checklist.md` — STROBE items mapped to outputs.

## Release candidate execution notes

Before any patient row preview, run the PHI package's `scripts/phi_preflight.py` locally and return only its summary. Do not paste raw patient previews into `phi_scan`; no-match is not privacy clearance. Use synthetic or approved de-identified data.
