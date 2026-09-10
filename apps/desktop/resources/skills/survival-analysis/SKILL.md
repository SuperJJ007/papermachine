---
name: survival-analysis
description: "生存分析。KM 风险表、log-rank、Cox、PH 检验、竞争风险、RMST。触发: KM曲线、Cox回归、风险比、总生存、无进展生存、删失。Use for time-to-event data with follow-up and an event/censoring indicator (OS, PFS, DFS, HR). RMST variance is Greenwood on the KM step function; cross-check survRM2."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
---

# Survival Analysis

Estimate and compare time-to-event outcomes through `run_python` (`lifelines`, `scikit-survival`) or `run_r` (`survival`, `survminer`, `cmprsk`), with the assumption checks that reviewers of oncology and cardiology journals expect.

## Installation

Install via `install_science_packages` unless the biomedical declaration is actually provisioned: Python `lifelines>=0.29`, `scikit-survival`; R `r-survival`, `r-survminer`, `r-cmprsk`, `r-tidycmprsk`, `r-ggsurvfit`, `r-rms`. Hosts do not auto-load `biomedical.json` from this repository.

## Workflow

1. **Verify the time and event columns.** Time must be > 0 and in one unit (say which). Event = 1 for the event of interest, 0 for censored. Print `n`, events, censoring proportion, median follow-up by **reverse Kaplan-Meier** (`scripts/km_analysis.py::median_follow_up`) — not the median of observed times.
2. **Describe.** Kaplan-Meier per group with a **number-at-risk table**, 95% CI bands, median survival with CI, and survival probabilities at clinically meaningful time points (1/3/5 years). Use `scripts/km_analysis.py` (declares PNG via `raster_artifacts`).
3. **Compare groups.** Log-rank test for the primary comparison. If curves cross, log-rank has low power — report RMST difference (`scripts/rmst.py`) or a weighted log-rank and say why.
4. **Model.** Cox PH with pre-specified covariates (`scripts/cox_model.py`). Rules: ≥10 events per parameter; check linearity of continuous covariates (splines or martingale residuals); use `strata()` for variables that violate PH but are not of interest.
5. **Check proportional hazards** — Schoenfeld residual test and plot for every covariate. If violated for the exposure: time-varying coefficient (`arm * log(t)`), a piecewise HR by period, or RMST. Never report a single HR for a clearly non-proportional effect without saying it is an average over follow-up.
6. **Competing risks.** If subjects can experience an event that precludes the one of interest (death before relapse, transplant before death), do **not** censor it for absolute risk: report cumulative incidence (Aalen-Johansen) and a Fine-Gray subdistribution HR for prognosis, plus cause-specific Cox for aetiology (`references/competing_risks.md`).
7. **Immortal time and time-dependent exposures.** Exposures that begin after time zero (treatment received later, response status) need a landmark analysis or a time-varying covariate. Naive grouping is a fatal flaw.
8. **Report** per `references/reporting.md`: n, events, median follow-up, median survival (CI), HR (CI, p), PH check result, model covariates.

## Key Rules

- Time zero must be the same clinically for every subject (randomization, diagnosis, surgery).
- Report HR **with** absolute measures (median survival, survival at t, RMST). An HR of 0.7 means nothing without baseline risk.
- p-values from the log-rank test and from the Cox model differ; report the one your SAP named.
- Do not dichotomize a continuous biomarker at the "optimal" cut-point found in the same data (inflated type I error). If you must, use a pre-specified cut and validate.
- A univariable → multivariable "p < 0.1 screening" procedure is not a valid variable-selection method for a prognostic model; prefer clinically pre-specified covariates or penalization.

## Resources

- `scripts/km_analysis.py` — KM with risk table, medians, landmark survival, reverse-KM follow-up.
- `scripts/cox_model.py` — Cox fit, forest plot of HRs, Schoenfeld PH test, concordance.
- `scripts/rmst.py` — restricted mean survival time difference with CI.
- `references/competing_risks.md` — cumulative incidence and Fine-Gray in Python/R.
- `references/reporting.md` — reporting template and common reviewer objections.
