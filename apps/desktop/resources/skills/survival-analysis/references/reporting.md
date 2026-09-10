# Reporting time-to-event results

**Template:** "Median follow-up was X months (reverse KM). Median OS was A months (95% CI a1–a2) in the treatment arm versus B months (95% CI b1–b2) in the control arm; 3-year OS 62% vs 48%. The hazard ratio for death was 0.71 (95% CI 0.58–0.87; log-rank P = .001), adjusted for [covariates] in a Cox model stratified by [strata]. The proportional-hazards assumption was assessed by Schoenfeld residuals (global P = .42)."

## Reviewer objections and pre-emptive answers
- *"How was follow-up defined?"* → reverse KM; state data cut-off date.
- *"Curves cross — is the HR meaningful?"* → report RMST difference at τ and a piecewise HR.
- *"Was the PH assumption tested?"* → Schoenfeld test + plot for each covariate.
- *"Events per variable?"* → ≥10 EPV or penalized model; report the count.
- *"Death is a competing risk for relapse."* → CIF + Fine-Gray, not 1 − KM.
- *"Responders vs non-responders comparison"* → immortal-time bias; use landmark at fixed time or time-dependent covariate.
- *"Optimal cut-off for the biomarker?"* → pre-specified or externally validated only; otherwise keep continuous with splines.
