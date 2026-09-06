# Survival methods beyond KM/Cox, and how to report

## Sample size for a two-arm log-rank comparison (Schoenfeld)

Required events: `d = (z_{1-α/2} + z_{1-β})² / (p₁ p₂ (ln HR)²)` with allocation fractions p₁, p₂ (0.5/0.5 → denominator 0.25).
Example: HR 0.7, α 0.05 two-sided, power 0.8 → `d = (1.96 + 0.842)² / (0.25 × 0.1272) ≈ 247` events. Convert to patients with the expected event probability by the analysis time (from the control arm's KM: `P(event) = 1 − S(t)` averaged over accrual). lifelines has no built-in; compute it directly and show the formula. In R, `powerSurvEpi::ssizeCT.default` or `gsDesign::nSurv` if installed.

## Restricted mean survival time (RMST)

Area under the KM curve up to τ (choose τ ≤ minimum of the arms' maximum follow-up, state it). Difference in RMST is an absolute, assumption-free effect size — the recommended alternative when proportional hazards fail (crossing curves, delayed separation in immunotherapy trials).
Python: `lifelines.utils.restricted_mean_survival_time(kmf, t=τ)`; R: `survRM2::rmst2(time, status, arm, tau=τ)` returns the difference with CI and p.

## Competing risks

| Quantity | Estimator | Interpretation |
|----------|-----------|----------------|
| Cumulative incidence of event k | Aalen–Johansen (`lifelines.AalenJohansenFitter(event_of_interest=k)`, `cmprsk::cuminc`) | Probability of event k by time t in the presence of other events — the clinically meaningful risk |
| 1 − KM treating competing events as censored | KM | Overestimates; a hypothetical world where competing events cannot happen |
| Cause-specific HR | Cox on event k, competing events censored | Etiological effect on the hazard of k among those still at risk |
| Sub-distribution HR (Fine–Gray) | `cmprsk::crr`, `tidycmprsk::crr` | Effect on the cumulative incidence; used for prediction |

Report both cause-specific and sub-distribution models when the question is prognostic; say which is which.

## Time-varying covariates and immortal time

Exposures that begin after baseline (a treatment started mid-follow-up, a transplant, a response) make early follow-up "immortal" for the exposed group. Fixes: **landmark analysis** (restart the clock at a fixed time, classify exposure by that time, exclude earlier events) or a **time-varying Cox** in counting-process format (`start, stop, event` rows; `survival::tmerge` or `lifelines.CoxTimeVaryingFitter`). Never compare "responders vs non-responders" from baseline without one of these.

## Parametric models

`WeibullAFTFitter`, `LogNormalAFTFitter`, `LogLogisticAFTFitter` (`survreg(dist=)` in R). Coefficients are log time ratios: `exp(coef) = 1.3` means 30 % longer expected survival. Choose by AIC and by a Q–Q/Cox–Snell residual check. Weibull with shape 1 is exponential; report the shape.

## Cutpoint selection

`survminer::surv_cutpoint(df, time, event, variables, minprop = 0.1)` uses maximally selected rank statistics with the Hothorn–Lausen correction. Report the corrected p and the number of candidate cutpoints; an "optimal" cutpoint found in the discovery cohort overfits — validate externally or with bootstrap.

## Reporting template

> Median follow-up was X months (reverse KM). Among N patients, E events occurred. Median OS was A months (95 % CI a₁–a₂) in group 1 versus B months (95 % CI b₁–b₂) in group 2 (log-rank p = 0.0xx); 3-year OS was P₁ % vs P₂ %. In multivariable Cox regression adjusting for age, sex, and stage, group 2 was associated with a hazard ratio of HR (95 % CI l–u, p = 0.0xx); the concordance index was C. The proportional-hazards assumption was assessed by scaled Schoenfeld residuals (global p = 0.xx) [and was violated for covariate Z, which was therefore entered as a stratification factor]. Analyses used lifelines v… / R survival v….

Figures: KM with risk table (censor marks, CI bands), forest plot of the multivariable model with HR text, and — when non-proportional — a plot of the scaled Schoenfeld residuals or the RMST comparison.
