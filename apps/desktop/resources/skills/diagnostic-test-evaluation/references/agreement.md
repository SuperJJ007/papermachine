# Agreement and reliability

| Data | Statistic | Python | R | Interpretation (Landis-Koch / Koo-Li) |
|---|---|---|---|---|
| 2 raters, nominal | Cohen's κ | `sklearn.metrics.cohen_kappa_score` | `irr::kappa2` | <0.2 slight, 0.2–0.4 fair, 0.4–0.6 moderate, 0.6–0.8 substantial, >0.8 almost perfect |
| 2 raters, ordinal | Weighted κ (quadratic) | `cohen_kappa_score(weights="quadratic")` | `irr::kappa2(weight="squared")` | same |
| ≥3 raters, nominal | Fleiss' κ | `statsmodels.stats.inter_rater.fleiss_kappa` | `irr::kappam.fleiss` | same |
| Continuous, absolute agreement | ICC(2,1) two-way random | `pingouin.intraclass_corr` (ICC2) | `irr::icc(model="twoway", type="agreement", unit="single")` | <0.5 poor, 0.5–0.75 moderate, 0.75–0.9 good, >0.9 excellent |
| Two methods, continuous | Bland-Altman (bias, LoA ±1.96 SD) | `pingouin.plot_blandaltman` | `blandr` / manual | Judge LoA against clinical tolerance, not p-values |

Report κ with 95% CI and the prevalence of each category (κ paradox: low κ with high raw agreement when prevalence is extreme — also report prevalence- and bias-adjusted kappa, PABAK).

```python
import pingouin as pg
icc = pg.intraclass_corr(data=long_df, targets="subject", raters="rater", ratings="value")
print(icc[icc.Type == "ICC2"])
```
