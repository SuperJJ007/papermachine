# Competing risks

**When:** a competing event prevents the event of interest (death before relapse; discharge before ICU infection). Censoring competing events overestimates the cumulative incidence (1 − KM is biased upward).

| Question | Estimand | Python | R |
|---|---|---|---|
| Absolute risk of event k by time t | Cumulative incidence function (Aalen-Johansen) | `lifelines.AalenJohansenFitter().fit(T, E, event_of_interest=1)` — `event_of_interest` is a **fit()** argument, not a constructor argument | `cmprsk::cuminc(ftime, fstatus, group)`; `tidycmprsk::cuminc(Surv(t, status) ~ arm)` (needs `r-tidycmprsk` + `r-ggsurvfit`) |
| Effect of covariate on absolute risk (prognosis / prediction) | Fine-Gray subdistribution HR | `scikit-survival` has no FG; call R via `run_r` | `cmprsk::crr(ftime, fstatus, cov1)`; `tidycmprsk::crr(Surv(t,status) ~ age + arm)` |
| Effect on rate among those still at risk (aetiology) | Cause-specific HR | `CoxPHFitter` treating competing events as censored | `coxph(Surv(t, status == 1) ~ ...)` |

Report **both** cause-specific and subdistribution HRs when the question is ambiguous, and always the CIF plot. `status` must be coded 0 = censored, 1 = event of interest, 2 = competing event (as a factor in R).

```r
library(tidycmprsk); library(ggsurvfit)
df$status <- factor(df$status, levels = 0:2, labels = c("censor","relapse","death"))
ci <- cuminc(Surv(time, status) ~ arm, data = df)
p <- ggcuminc(ci, outcome = "relapse") + add_confidence_interval() + add_risktable()
ggsave(file.path(Sys.getenv("SCIENCE_ARTIFACT_DIR"), "cif.png"), p, width = 8, height = 6, dpi = 200)
fg <- crr(Surv(time, status) ~ arm + age, data = df); tbl_regression(fg, exponentiate = TRUE)
```
