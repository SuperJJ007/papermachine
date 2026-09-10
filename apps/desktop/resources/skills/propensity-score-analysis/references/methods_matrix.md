# Method → estimand → R equivalent

| Method | Estimand | Pros | Cons | R |
|---|---|---|---|---|
| 1:1 NN matching, caliper 0.2 | ATT | Intuitive, Table-1-like output | Discards data; SE must account for pairs | `MatchIt::matchit(method="nearest", caliper=.2)` |
| Full/optimal matching | ATT/ATE | Uses all units | Complex weights | `matchit(method="full")` |
| IPTW (stabilized) | ATE | Keeps all subjects; time-varying extension (MSM) | Extreme weights; trimming needed | `WeightIt::weightit(method="glm", estimand="ATE", stabilize=TRUE)` |
| Overlap weights | ATO | Exact mean balance, no extreme weights | Population less interpretable | `weightit(estimand="ATO")` |
| Stratification (quintiles) | ATE-ish | Simple | ~10% residual bias | `matchit(method="subclass")` |
| Doubly robust (AIPW/TMLE) | ATE | Consistent if either model right | Implementation complexity | `AIPW`, `tmle` |
| Balance | — | `cobalt::bal.tab`, `love.plot` | — | |
| Effect | — | `marginaleffects::avg_comparisons(vcov=~subclass)`; `survey::svyglm` for weights | — | |

Sensitivity: `EValue::evalues.OR()`, `rbounds` (Rosenbaum Γ) for matched pairs.
