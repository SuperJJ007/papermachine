---
name: diagnostic-test-evaluation
description: "诊断试验评价。ROC/AUC（DeLong）、灵敏度/特异度、PPV/NPV、截断值、决策曲线、Kappa、STARD。触发: ROC曲线、约登指数、一致性。Use when comparing an index test or biomarker against a reference standard. Degenerate ROC/DeLong comparisons are flagged, not reported as p-values."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
  reporting-guideline: STARD 2015
---

# Diagnostic Test Evaluation

Quantify how well an index test or biomarker identifies a condition defined by a reference standard, through `run_python` (`scikit-learn`, `scipy`, `statsmodels`) or `run_r` (`pROC`, `epiR`, `dcurves`).

## Installation

Base environment suffices for Python. R extras via `install_science_packages`: `r-proc`, `r-epir`, `r-dcurves`, `r-irr`.

## Workflow

1. **Establish the 2×2 or continuous set-up.** Confirm: reference standard (and whether it was applied to everyone — partial verification bias), index test (binary or continuous), prevalence in the sample vs the target population, and whether readers were blinded.
2. **Binary test → accuracy metrics.** `scripts/diagnostic_accuracy.py::accuracy_from_counts(tp, fp, fn, tn)` prints sensitivity, specificity, PPV, NPV, LR+, LR−, DOR, accuracy, each with **Wilson/exact 95% CI**. Report PPV/NPV at the study prevalence *and* at the intended-use prevalence (Bayes' theorem).
3. **Continuous marker → ROC.** `scripts/roc_analysis.py::roc_with_ci` gives AUC with **DeLong 95% CI**, the ROC PNG (declare in `raster_artifacts`), and a threshold table. Compare two AUCs on the same subjects with `delong_test` (paired), never with two independent CIs.
4. **Choose a cut-off deliberately.** Youden's J maximizes Se+Sp−1 but weights errors equally; for a rule-out test target Se ≥ 0.95, for a rule-in test target Sp ≥ 0.95. Report the cut-off's Se/Sp with CIs and state that a data-derived cut-off is optimistic until externally validated.
5. **Clinical utility.** Decision curve analysis (`scripts/decision_curve.py`) — net benefit across threshold probabilities versus treat-all/treat-none. An AUC of 0.75 can still have no clinical utility in the relevant threshold range.
6. **Calibration** (for probability outputs): calibration slope/intercept, calibration plot with loess, Brier score. AUC without calibration is half a picture.
7. **Agreement** between readers/methods: Cohen's/Fleiss' kappa for categorical, ICC(2,1) for continuous, Bland-Altman for method comparison (`references/agreement.md`). Do not use Pearson r for agreement.
8. **Report** against STARD 2015 (`references/stard_checklist.md`): flow diagram, cross-tabulation, estimates with CIs, indeterminate results, adverse events from testing.

## Key Rules

- Sensitivity and specificity are properties of the test at a cut-off; PPV/NPV depend on prevalence — always state prevalence.
- Never exclude indeterminate/uninterpretable index-test results silently; report them and run a sensitivity analysis (count as positive, as negative).
- Case-control designs (known diseased vs healthy) inflate accuracy (spectrum bias); say so.
- Report the number of positives and negatives — a 95% CI for Se from 8 cases is uninformative.
- Compare AUCs with a paired DeLong test; report the AUC difference with CI.

## Resources

- `scripts/diagnostic_accuracy.py` — 2×2 metrics with CIs, prevalence-adjusted PPV/NPV, Fagan nomogram values.
- `scripts/roc_analysis.py` — AUC, DeLong CI and paired test, ROC plot, threshold table, Youden.
- `scripts/decision_curve.py` — decision curve analysis / net benefit plot.
- `references/agreement.md` — kappa, ICC, Bland-Altman code.
- `references/stard_checklist.md` — STARD 2015 items mapped to outputs.
