# Reviewer objections to pre-empt
| Objection | Answer |
|---|---|
| "Only 40 events for 12 predictors" | EPV 3.3 — reduce predictors, penalize heavily, or declare exploratory. |
| "Stepwise selection" | Unstable; replace by pre-specified set + lasso/ridge and report bootstrap inclusion frequencies if selection is needed. |
| "Random 70/30 split" | Wastes data and gives noisy estimates; bootstrap or repeated CV on the full sample. |
| "AUC 0.98" | Check leakage (post-outcome predictors), overfitting, spectrum. Report optimism-corrected AUC. |
| "SMOTE/oversampling" | Distorts calibration; prediction models need calibrated probabilities, not balanced classes. |
| "NRI shows improvement" | NRI is inflated by miscalibration; use ΔAUC with CI, calibration and decision curves. |
| "Optimal cut-off by Youden" | Threshold must follow clinical consequences; present DCA across thresholds. |
| "Risk groups (low/medium/high)" | Illustrative only; primary output is the continuous risk and the equation. |
| "No external validation" | State it; provide the full equation to allow it. |
