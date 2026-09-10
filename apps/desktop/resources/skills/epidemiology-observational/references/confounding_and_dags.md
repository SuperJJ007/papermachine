# Confounding, DAGs and adjustment

## Rules
1. **Confounder**: common cause of exposure and outcome → adjust.
2. **Mediator**: on the causal path exposure → M → outcome → do *not* adjust for the total effect (adjusting gives the direct effect, with its own assumptions).
3. **Collider**: common effect of two variables → adjusting opens a spurious path (selection bias, Berkson). Includes conditioning by design (hospital-based controls, restricting to survivors).
4. **Instrument / exposure-only cause**: adjusting amplifies bias (Z-bias); leave out.
5. **Post-baseline variables** are candidates for mediators/colliders — default exclude.

## Practical steps
- Write the DAG as edges: `smoking -> lung_cancer; age -> smoking; age -> lung_cancer; ses -> smoking; ses -> lung_cancer`.
- In R: `dagitty::adjustmentSets(dag, exposure="smoking", outcome="lung_cancer")`.
- Report crude, minimally-adjusted (age, sex) and fully-adjusted models; describe the change-in-estimate.
- **Negative control** exposure/outcome to detect residual confounding.
- **Time-varying confounding affected by prior exposure** (e.g. CD4 count in HIV treatment) → standard regression is biased; use IPTW/marginal structural models or g-methods.

## Bias catalogue
| Bias | Typical cause | Mitigation |
|---|---|---|
| Immortal time | Exposure defined after time zero | Landmark / time-varying exposure |
| Prevalent user | Comparing current users with never-users | New-user (incident) design, active comparator |
| Confounding by indication | Sicker patients get the drug | Active comparator, PS methods (load `propensity-score-analysis`) |
| Detection bias | Exposed screened more often | Adjust for surveillance intensity, lag analysis |
| Reverse causation | Early disease changes exposure | Lag/exclude first years of follow-up |
| Selection (collider) | Conditioning on participation/survival | IPCW, quantitative bias analysis |
