---
name: survival-analysis
description: "Time-to-event analysis with lifelines (Python, shipped) or survival + survminer (R, shipped) — Kaplan–Meier curves with risk tables and log-rank tests, median survival with CIs, Cox proportional-hazards regression with hazard ratios and forest plots, proportional-hazards checking (Schoenfeld residuals), stratified and time-varying Cox, competing risks (cumulative incidence, Fine–Gray), parametric AFT models, landmark analysis, and sample-size for a log-rank design. Use whenever data has a time and an event/censoring column, or a user mentions survival, prognosis, hazard ratio, censoring, TCGA clinical data, or a biomarker's effect on outcome. Trigger terms: 生存分析、KM 曲线、Kaplan-Meier、log-rank、Cox 回归、风险比、HR、删失、预后、无进展生存、PFS、OS、竞争风险、森林图."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Survival Analysis

Run time-to-event analyses through `run_python` (lifelines) or `run_r` (survival, survminer), and write every curve, forest plot, and result table to `SCIENCE_ARTIFACT_DIR`. What a clinical reviewer checks: the event and censoring definitions are stated, the number at risk is shown under every curve, hazard ratios come with CIs and the proportional-hazards assumption was actually tested, and dichotomizing a continuous biomarker at a data-driven "optimal" cutpoint was either avoided or penalized and disclosed.

## Installation

Shipped: `lifelines`, `r-survival`, `r-survminer`, `r-broom`, `r-ggpubr`. Extras through `install_science_packages`:

| Need | Language | Spec |
|------|----------|------|
| Competing risks in R (Fine–Gray, CIF) | r | `r-cmprsk`, `r-tidycmprsk` |
| Time-dependent ROC / C-index over time | r | `r-timeroc`, `r-pec`; python: `scikit-survival` (conda-forge, all platforms) |
| Optimal-cutpoint with correction | r | `r-maxstat` (used by `survminer::surv_cutpoint`) |
| Restricted mean survival time | r | `r-survrm2` |
| Publication forest plots | r | `r-forestmodel` or `r-forestplot`; python: matplotlib (see `scripts/km_cox.py`) |

Compatibility traps: `lifelines` `CoxPHFitter.print_summary()` reports `exp(coef)` = HR; the columns are `coef, exp(coef), se(coef), coef lower 95%, coef upper 95%, exp(coef) lower 95%, exp(coef) upper 95%, z, p`. `KaplanMeierFitter.median_survival_time_` returns `inf` when the curve never crosses 0.5 — report "not reached", not infinity. In R, `survfit` with `Surv(time, status)` expects `status` coded `1 = event, 0 = censored` (or `2/1`); a `TRUE/FALSE` event column works, a character column does not. `ggsurvplot()` returns a list — save with `ggsave(path, print(p))` or extract `p$plot` (the risk table is a second grob; use `survminer::arrange_ggsurvplots` or `png(); print(p); dev.off()`).

## Workflow

1. **Define time, event, and origin.** Time unit (days → months by /30.44 when asked), what counts as an event (death of any cause = OS; progression or death = PFS), what is censored (alive at last follow-up, lost to follow-up), and the start of follow-up (diagnosis, surgery, randomization). Print n, events, censored, median follow-up by **reverse Kaplan–Meier** (`KaplanMeierFitter().fit(T, 1-E)`), and check for zero/negative times and events after censoring dates.
2. **Describe.** Table of covariates by group (n, %, median/IQR). Numbers at risk at fixed time points.
3. **Kaplan–Meier.** `KaplanMeierFitter` per group with 95 % CI bands, censor ticks, a risk table below (`lifelines.plotting.add_at_risk_counts`), median survival with CI (`median_survival_times(kmf.confidence_interval_)`), and 1/3/5-year survival estimates with CI. Log-rank (`lifelines.statistics.logrank_test` / `multivariate_logrank_test`) for the overall comparison; pairwise log-rank with Holm/BH correction for > 2 groups. `scripts/km_cox.py::km_plot` draws the standard figure; declare its PNG in `raster_artifacts` and `annotate_artifact` it.
4. **Cox regression.** Univariable Cox for each candidate covariate (table: HR, 95 % CI, p, n, events), then a multivariable model with covariates chosen **a priori** (clinical knowledge, not univariable p < 0.1 screening, unless the user insists — then label it exploratory). Rule of thumb: ≥ 10 events per covariate. Report HR, 95 % CI, p, concordance index, and a forest plot. Continuous covariates stay continuous; check functional form (martingale residuals or a restricted cubic spline via `patsy`/`rms`) before assuming linearity.
5. **Check proportional hazards.** `cph.check_assumptions(df, p_value_threshold=0.05, show_plots=True)` (scaled Schoenfeld) or `survival::cox.zph(fit)` with `ggcoxzph`. If violated for a covariate: stratify on it (`strata=`), add a time interaction, split follow-up at a landmark, or report RMST difference instead — and say which.
6. **Extensions when the question needs them.** Competing risks (death from other causes when the endpoint is cancer-specific death): cumulative incidence with `lifelines.AalenJohansenFitter` or `cmprsk::cuminc`, Fine–Gray sub-distribution HR with `cmprsk::crr`; 1 − KM overestimates the event risk here — say so. Time-varying covariates: long format + `CoxTimeVaryingFitter` / `survival::tmerge`. Landmark analysis for treatment received after baseline (immortal-time bias). Parametric AFT (`WeibullAFTFitter`, `LogNormalAFTFitter`) when extrapolation or a time-ratio interpretation is wanted; compare by AIC.
7. **Biomarker cutpoints.** Prefer continuous HR per SD or per unit, tertiles/quartiles, or a median split stated in advance. If an optimal cutpoint is requested: `survminer::surv_cutpoint` (maximally selected rank statistics with a corrected p) and state that the p-value is corrected for cutpoint selection; validate on a held-out set if available.
8. **Report.** n, events, median follow-up; KM medians and time-point survival with CI; log-rank χ² and p; univariable and multivariable HR tables; PH test results and remedies; software versions (`lifelines.__version__`, `packageVersion("survival")`).

## Integrity rules

1. **Every KM figure has a risk table and censor marks.** A curve without numbers at risk hides where the estimate becomes unreliable.
2. **Never dichotomize a continuous variable at the cutpoint with the smallest p** without a selection-corrected test and disclosure.
3. **Hazard ratios are relative, not absolute.** Pair the HR with absolute differences (median survival or 5-year survival difference) in the write-up.
4. **A non-proportional hazard makes a single HR an average over follow-up** — report the check, and if violated, report a time-stratified or RMST alternative.
5. **Competing events are not censoring.** Use cumulative incidence when the competing event prevents the endpoint.
6. **Immortal time**: exposure defined after baseline needs a landmark or time-varying model.
7. **Multiple testing** across many biomarkers or subgroups is corrected and reported; subgroup forest plots include the interaction p, not just per-subgroup p.

## Quick reference

```python
from lifelines import KaplanMeierFitter, CoxPHFitter
from lifelines.statistics import logrank_test, multivariate_logrank_test
from lifelines.utils import median_survival_times

kmf = KaplanMeierFitter().fit(df["time"], df["event"], label="All")
kmf.median_survival_time_, median_survival_times(kmf.confidence_interval_)
kmf.predict([12, 36, 60])                                      # survival at time points
lr = multivariate_logrank_test(df["time"], df["group"], df["event"]); lr.test_statistic, lr.p_value

cph = CoxPHFitter().fit(df[["time","event","age","sex","stage"]], "time", "event", formula="age + C(sex) + C(stage)")
cph.summary[["exp(coef)","exp(coef) lower 95%","exp(coef) upper 95%","p"]]; cph.concordance_index_
cph.check_assumptions(df, p_value_threshold=0.05)
```

```r
library(survival); library(survminer)
fit <- survfit(Surv(time, event) ~ group, data = df)
p <- ggsurvplot(fit, data = df, risk.table = TRUE, pval = TRUE, conf.int = TRUE, surv.median.line = "hv",
                xlab = "Months", break.time.by = 12, legend.title = "")
png(file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), "km_by_group.png"), width = 1800, height = 1500, res = 220); print(p); dev.off()
survdiff(Surv(time, event) ~ group, data = df)
cox <- coxph(Surv(time, event) ~ age + sex + stage, data = df); summary(cox); cox.zph(cox)
broom::tidy(cox, exponentiate = TRUE, conf.int = TRUE)
```

Files: `scripts/km_cox.py` (`km_plot`, `cox_table`, `forest_plot`, `follow_up_summary`), `references/methods_and_reporting.md` (sample size for log-rank, RMST, competing risks, reporting template).
