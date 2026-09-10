# Primary-endpoint model by endpoint type

| Endpoint | Recommended primary model | Python | R | Effect measure |
|---|---|---|---|---|
| Continuous, single post-baseline visit | ANCOVA: `y_post ~ arm + y_base + strata` | `smf.ols(...).fit()` | `lm(y_post ~ arm + y_base + strata)` | Adjusted mean difference |
| Continuous, repeated visits | MMRM with **unstructured residual covariance**, visit×arm, LS-means at the primary visit | Not equivalent in statsmodels: `MixedLM(..., re_formula="~visit")` is a **random intercept + random slope** model, not unstructured residual MMRM. Prefer R `mmrm`. | `mmrm::mmrm(y ~ arm * visit + y_base + us(visit \| id))` (unstructured residual). `nlme::gls(..., correlation=corSymm(form=~1\|id), weights=varIdent(form=~1\|visit))` is a related GLS form. Do not label MixedLM/lmer random-slope fits as unstructured MMRM. | LS-mean difference at primary visit |
| Binary | Logistic regression + stratification factors; also report RD & NNT | `smf.logit`; `binary_effects.py` | `glm(family=binomial)`; `epitools::riskratio` | OR, RR, RD |
| Ordinal (e.g. mRS) | Proportional-odds; check PO assumption | `OrderedModel(distr="logit")` | `MASS::polr`, `rms::orm` | Common OR |
| Time-to-event | Cox PH stratified by strata; check PH | `lifelines.CoxPHFitter(strata=...)` | `coxph(Surv(t,e) ~ arm + strata(site))` | HR + KM medians + RMST |
| Count / exacerbation rate | Negative binomial, offset log(follow-up) | `smf.glm(family=NegativeBinomial(), offset=np.log(fu))` | `MASS::glm.nb(... + offset(log(fu)))` | Rate ratio |
| Cluster-randomized | GLMM with cluster random intercept or GEE exchangeable | `smf.mixedlm(..., groups="cluster")` / `GEE` | `lme4::glmer(... + (1|cluster))` | Report ICC |

## Estimands (ICH E9(R1))
Name the strategy for every intercurrent event: **treatment policy** (ITT, ignore the event), **hypothetical** (as if it had not occurred — MMRM under MAR), **composite** (event counts as failure), **while-on-treatment**, **principal stratum**. Say which one the primary analysis targets.

## Non-inferiority
- Declare margin Δ and its justification (fraction of historical effect preserved, usually 50%).
- Conclude NI when the CI upper (or lower) bound excludes Δ. Do both ITT and PP.
- If NI is shown, superiority may be tested on the same CI without alpha penalty (closed test).

## Multiplicity toolbox
Hierarchical (fixed-sequence) testing, Holm step-down, Hochberg step-up, Bonferroni (conservative), graphical approaches (Bretz). State the procedure and which endpoints entered the family.
