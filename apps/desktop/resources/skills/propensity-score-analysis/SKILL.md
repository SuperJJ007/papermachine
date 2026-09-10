---
name: propensity-score-analysis
description: "倾向性评分。PSM、IPTW、Love 图、SMD、ATE/ATT。触发: 匹配、逆概率加权、标准化均数差、因果推断、真实世界研究。Use when comparing treated vs untreated patients without randomization."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
---

# Propensity Score Analysis

Estimate treatment effects from observational data with explicit design-stage confounding control, through `run_python` (`scripts/propensity.py`, `statsmodels`, `scikit-learn`) or `run_r` (`MatchIt`, `WeightIt`, `cobalt`, `marginaleffects`).

## Installation

Python: base environment. R via `install_science_packages`: `r-matchit`, `r-weightit`, `r-cobalt`, `r-marginaleffects`, `r-sandwich`.

## Workflow

1. **Define the causal question**: treatment (binary, at a well-defined time zero), comparator (active comparator preferred over non-users), outcome, estimand (**ATT** — effect in those treated; **ATE** — whole population; **ATO** — overlap population), and follow-up. Use the new-user design where possible.
2. **Select covariates for the PS** from a DAG: confounders and pure outcome predictors measured **before** treatment. Exclude instruments, mediators and post-treatment variables (load `epidemiology-observational` for DAG rules).
3. **Estimate the PS** with logistic regression (`propensity.py::estimate_ps`), including non-linear terms/interactions if balance demands; gradient boosting is an option. Plot PS distributions by group and report **overlap/common support**; trim non-overlapping regions.
4. **Choose the method**: matching (1:1 nearest-neighbour, caliper 0.2 SD of the logit PS, without replacement) → ATT; IPTW with stabilized weights → ATE; overlap weights → ATO with best balance; stratification (quintiles) as a robustness check. `propensity.py::match_caliper`, `::iptw_weights`.
5. **Assess balance** — **before and after** — with absolute SMD for every covariate (threshold 0.1) and variance ratios; draw the Love plot (`propensity.py::love_plot`, declare PNG). Balance, not the PS model's c-statistic, is the diagnostic. Iterate on the PS model until balance is achieved.
6. **Estimate the effect** on the matched/weighted sample: outcome model with treatment (and optionally the covariates again → doubly robust), **robust/cluster SE** (matched pairs or weights). Report the absolute and relative effects with CIs. For time-to-event use weighted Cox (load `survival-analysis`).
7. **Sensitivity**: E-value for unmeasured confounding, alternative calipers/estimands, negative-control outcome, and the effective sample size after weighting (`propensity.py::effective_n`).
8. **Report**: covariate list and rationale, PS model, method and estimand, sample sizes at each step, balance table (SMD before/after), Love plot, effect with CI, sensitivity analyses. Statement: "Propensity-score methods address measured confounding only."

## Key Rules

- Never test balance with p-values (they depend on n); use SMD.
- Do not include the outcome or post-treatment variables in the PS.
- Extreme weights (> 10) signal poor overlap; trim/truncate at 1st/99th percentile and report both analyses.
- Matched analyses require SEs that account for matching (cluster on pair or use a paired test).
- The estimand changes with the method — say which population your estimate applies to.

## Resources

- `scripts/propensity.py` — PS estimation, caliper matching, stabilized IPTW, overlap weights, SMD balance table, Love plot, effective sample size, weighted effect estimation with robust SE.
- `references/methods_matrix.md` — matching vs weighting vs stratification, R equivalents, estimand mapping.

## Release candidate execution notes

Before any patient row preview, run the PHI package's `scripts/phi_preflight.py` locally and return only its summary. Do not paste raw patient previews into `phi_scan`; no-match is not privacy clearance. Use synthetic or approved de-identified data.
SMD `inf` indicates complete separation and `nan` means insufficient data; neither is balanced. Review missingness explicitly. In propensity matching, each treated subject and all retained controls share one `pair` ID; only complete 1:k sets are retained, without replacement. Report unmatched subjects and attrition.
