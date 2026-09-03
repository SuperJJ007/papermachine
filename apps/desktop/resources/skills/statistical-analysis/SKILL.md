---
name: statistical-analysis
description: "Guided statistical analysis — test selection, assumption checking, effect sizes, power analysis, Bayesian alternatives, APA-formatted reporting. Use whenever a user wants to compare groups, test a hypothesis, analyze data, check assumptions, compute sample sizes, or write up results, even without naming a test. Covers t-tests, ANOVA, chi-square, correlation, regression, non-parametric, Bayesian methods. Trigger terms: 统计分析、假设检验、回归、显著性、t检验、方差分析."
license: MIT license
metadata:
  version: "1.1"
  skill-author: K-Dense Inc.
---

# Statistical Analysis

Conduct hypothesis tests, regression, correlation, and Bayesian analyses through `run_python`, with systematic assumption checking, effect sizes, and APA-style reporting. Aim for an analysis a reviewer cannot tear apart: right test, verified assumptions, honest effect sizes, complete write-up.

## Installation

Install through `install_science_packages`, not shell `pip`/`uv`: `pingouin>=0.6`, `scipy>=1.11`, `statsmodels>=0.14.6`, `pandas`, `matplotlib`, `seaborn`; Bayesian: `pymc>=5.0`, `arviz>=1.0`.

**Compatibility traps:** Pingouin 0.6.0 renamed output columns (`p_val`/`cohen_d`/`CI95`/`p_unc`, from `p-val`/`cohen-d`/`CI95%`/`p-unc`). `statsmodels>=0.14.6` needs `scipy>=1.11` (else `_lazywhere` import errors). ArviZ 1.x `az.summary()` defaults to **89% intervals** via `ci_prob` (not `hdi_prob`) — pass `ci_prob=0.95` for 95%. One-sided Bayes Factors are gone from Pingouin — use PyMC directly. Details: `references/effect_sizes_and_power.md`, `references/bayesian_statistics.md`.

## Analysis Workflow

Skipping steps is how analyses end up retracted — work through them in order and say what you did at each one.

1. **Frame the question first.** State the hypothesis, outcome/predictor variables, and design (independent vs. paired, group count). Commit to a planned test now — choosing it after peeking at results is p-hacking, even done innocently.
2. **Inspect the data.** Per group: n, mean, SD, median, missing values. Plot raw data before any test. Surface unequal group sizes, missingness, floor/ceiling effects, and outliers instead of working around them silently.
3. **Select the test** from the quick reference below, or `references/test_selection_guide.md` for designs beyond basics.
4. **Check assumptions** with `scripts/assumption_checks.py`. If one fails, switch to the remedial test (below) and report the plan and the change.
5. **Run the test** with the right library (below) and always compute the effect size alongside it — a p-value says an effect exists; the effect size says whether anyone should care.
6. **Report** using APA style below: descriptives, exact statistics, effect sizes with CIs, assumption checks performed.

If the user only needs one step ("how many participants do I need?"), jump straight there but still confirm the design assumptions the calculation rests on.

## Test Selection Guide

**Two groups:** independent+normal → t-test; independent+non-normal → Mann-Whitney U; paired+normal → paired t-test; paired+non-normal → Wilcoxon; binary outcome → chi-square/Fisher's. **3+ groups:** independent+normal → one-way ANOVA; independent+non-normal → Kruskal-Wallis; paired+normal → repeated-measures ANOVA; paired+non-normal → Friedman. **Relationships:** two continuous → Pearson (normal)/Spearman (non-normal); continuous outcome+predictors → linear regression; binary outcome+predictors → logistic regression.

**Bayesian alternatives** exist for every test above (probability statements, Bayes Factors, support for the null); consider them with prior information to incorporate, small/sequential n (no correction needed for optional stopping), a need for evidence *for* the null, or a complex hierarchical/missing-data model. Priors, Bayes Factors, credible intervals, convergence checks (R-hat < 1.01, sufficient ESS): `references/bayesian_statistics.md`. Counts, survival, reliability, factorial: `references/test_selection_guide.md`.

**Libraries:** **pingouin** (returns effect sizes by default, prefer it — `pg.ttest(a, b, correction='auto')` applies Welch's correction), **scipy.stats** (core tests), **statsmodels** (regression/diagnostics/power), **pymc**+**arviz** (Bayesian; scale priors to the observed SD).

## Assumption Checking

Always check assumptions before interpreting results, and report the checks — reviewers look for them. Use `scripts/assumption_checks.py`'s `comprehensive_assumption_check(data, value_col, group_col=None, alpha=0.05)` for outliers+normality+homogeneity in one call, or its individual normality/homogeneity/linearity/`check_regression_diagnostics`/`detect_outliers` functions.

**When violated** — normality: mild+n>30/group → proceed; moderate → non-parametric; severe → transform or non-parametric. Variance: t-test → Welch's (`correction='auto'`); ANOVA → Welch's/Brown-Forsythe; regression → robust SEs/WLS. Linearity: polynomial terms, transforms, or non-linear/GAM. For n ≥ 100, weigh the Q-Q plot over the Shapiro-Wilk p-value. Guidance: `references/assumptions_and_diagnostics.md`.

## Effect Sizes

**Effect sizes quantify magnitude; p-values only indicate existence.** Report one for every test.

| Test | Effect Size | Small | Medium | Large |
|------|-------------|-------|--------|-------|
| T-test | Cohen's d | 0.20 | 0.50 | 0.80 |
| ANOVA | η²_p | 0.01 | 0.06 | 0.14 |
| Correlation | r | 0.10 | 0.30 | 0.50 |
| Regression | R² | 0.02 | 0.13 | 0.26 |
| Chi-square | Cramér's V | 0.07 | 0.21 | 0.35 |

Benchmarks are conventions, not laws — a "small" effect can matter enormously (drug side effects) and a "large" one trivial. Pingouin returns effect sizes with its tests (`cohen_d`, `np2`, `hedges`, `r`); report a CI with `pg.compute_esci` (`pg.compute_effsize_from_t` has no CI). Guide: `references/effect_sizes_and_power.md`.

## Power Analysis

A priori (planning): `statsmodels.stats.power` (`tt_ind_solve_power` for t-tests; `FTestAnovaPower().solve_power` for ANOVA — returns TOTAL N, not per group). Sensitivity (post-study): solve the same functions with `effect_size=None` given the observed n. **Post-hoc "observed power" is circular** — a deterministic function of p; run a sensitivity analysis instead. `references/effect_sizes_and_power.md`.

## Reporting Results

Follow `references/reporting_standards.md` for APA style and worked templates. Every report needs: descriptives (M, SD, n); test statistics (name, statistic, df, exact p — `p = .034` not `p < .05`, `p < .001` only below .001); effect sizes with CIs; assumption checks and actions taken; all planned analyses incl. non-significant findings — omitting them is cherry-picking.

## Statistical Integrity

The most common statistical failures are not computational errors — they are silent flexibility and selective reporting.

1. **Distinguish confirmatory from exploratory.** State the planned analysis before running it; label anything found along the way exploratory.
2. **Don't shop for significance.** A non-significant planned test is the result; alternative tests/subgroups/outlier-removal until p < .05 invalidates the p-value.
3. **Correct for multiple comparisons** (Tukey HSD post-hoc ANOVA; Holm or Benjamini-Hochberg FDR otherwise) and say which correction was used.
4. **Non-significance is not evidence of no effect.** Small n may mean underpowered — run a sensitivity analysis or a Bayesian/equivalence test for the null.
5. **Significance is not practical importance.** With large n, trivial effects reach p < .001 — lead with the effect size.
6. **Understand missing data before dropping rows.** Listwise deletion is safe only when data are missing completely at random; otherwise use multiple imputation and say so.
7. **Make it reproducible.** Set random seeds, report library versions for simulations, and keep the analysis runnable.
