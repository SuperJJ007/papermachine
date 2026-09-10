---
name: clinical-prediction-model
description: "临床预测模型。TRIPOD+AI（27 个主条目）、Riley 三准则样本量、Bootstrap 内部验证、校准、列线图。触发: 风险评分、内部验证、外部验证、校准曲线、C指数。Use to develop or evaluate a diagnostic/prognostic score. Local checklist is a working map, not the publisher PDF."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
  reporting-guideline: TRIPOD+AI
---

# Clinical Prediction Model

Build or validate a risk-prediction model that will survive external validation, through `run_python` (`scikit-learn`, `statsmodels`, `lifelines`) or `run_r` (`rms`, `pmsampsize`, `riskRegression`).

## Installation

Base environment + `lifelines` for survival outcomes. R via `install_science_packages`: `r-rms`, `r-pmsampsize`, `r-riskregression`, `r-dcurves`.

## Workflow

1. **Frame the model**: target population, prediction moment, outcome and horizon, intended use (rule-out, triage, treatment decision), and whether this is **development**, **internal validation**, **external validation**, or **updating** (TRIPOD type 1a–4). Distinguish *prediction* from *aetiology* — a prognostic model needs no causal covariates.
2. **Sample-size check** (`scripts/model_validation.py::riley_sample_size`): minimum n for the number of candidate predictor parameters, outcome prevalence and anticipated R²; report EPV. If under-powered, reduce parameters or use stronger penalization — do not proceed silently.
3. **Predictors**: pre-specify from literature/clinical knowledge; keep continuous variables continuous (restricted cubic splines, 3–4 knots); avoid univariable-p screening and stepwise selection (unstable, optimistic). Multiple-impute missing data; report missingness.
4. **Fit**: logistic (binary) or Cox (time-to-event) with **penalization** (ridge/lasso/elastic-net via `sklearn`/`glmnet`) or Firth for sparse events; for ML models (gradient boosting, RF) use the same validation discipline and compare against the regression baseline — clinical data rarely reward complexity.
5. **Internal validation by bootstrap** (`model_validation.py::bootstrap_validate`, ≥200 resamples): optimism-corrected AUC/C-index, calibration slope (shrinkage factor) and intercept. Apply the shrinkage factor to coefficients. Split-sample validation is inefficient — say why you did not use it if asked.
6. **Performance report**: discrimination (AUC/C with CI), calibration (plot with loess, slope, intercept/CITL, O:E ratio), overall (Brier, scaled Brier), clinical utility (decision curve — load `diagnostic-test-evaluation` scripts). All PNGs declared in `raster_artifacts`.
7. **Presentation**: full model equation (intercept + coefficients, baseline survival S₀(t) for Cox), a nomogram or points table (`scripts/nomogram.py`), risk groups only as illustration — never as the primary output.
8. **External validation** when a second dataset exists: apply the frozen model, report the same metrics, then recalibrate (intercept update → slope update → refit) if calibration is poor, and label the result as an updated model.
9. **Report** against the official TRIPOD+AI 27-item checklist (`references/tripod_checklist.md`). The local map is not the publisher PDF. Avoid NRI/IDI as primary comparison metrics (`references/pitfalls.md`).

## Key Rules

- Never dichotomize predictors or the outcome to "simplify".
- Data-driven cut-offs, optimal risk-group thresholds and "AUC = 0.95 on the training set" are red flags — report optimism-corrected metrics.
- Calibration is as important as discrimination; a miscalibrated model harms patients.
- Report the full equation so others can validate; a nomogram alone is not reproducible.
- Say what the model is *for* and at which risk threshold it would change management.

## Resources

- `scripts/model_validation.py` — Riley minimum sample size, bootstrap optimism correction, calibration slope/intercept, calibration plot, Brier.
- `scripts/nomogram.py` — points-based score table and simple nomogram figure from a fitted logistic model.
- `references/tripod_checklist.md` — TRIPOD+AI official scope and 27-item working map.
- `references/pitfalls.md` — common reviewer objections (EPV, stepwise, NRI, split-sample, class imbalance).
