---
name: bioassay-and-dose-response
description: "Wet-lab assay data analysis — dose–response curves (4PL/log-logistic, IC50/EC50/LD50 with CIs; scipy or R drc), microbial and cell growth curves (logistic/Gompertz fits, doubling time, lag, AUC), qPCR relative quantification (ΔΔCt, efficiency-corrected Pfaffl, reference-gene stability), ELISA and protein/DNA standard curves with back-calculation, Western blot and colony/plaque count comparisons, plate-layout aware replicate handling, Z′-factor for screening plates, and Michaelis–Menten enzyme kinetics. Use whenever a user has plate-reader output, Ct values, OD readings over time, concentrations vs response, or band intensities. Trigger terms: IC50、EC50、剂量反应、剂量效应、四参数、生长曲线、倍增时间、OD600、qPCR、ΔΔCt、2^-ΔΔCt、内参、标准曲线、ELISA、酶活、米氏、Km、Vmax、Z 因子、Western 定量、菌落计数."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine community
---

# Bioassay and Dose–Response Analysis

Fit, compare, and plot bench-experiment data through `run_python` (scipy, statsmodels, pandas) or `run_r` (drc, emmeans, rstatix), writing fitted parameters, per-replicate tables, and figures to `SCIENCE_ARTIFACT_DIR`. The bar to clear: technical replicates are averaged **before** any test so that the unit of inference is the biological replicate; every fitted parameter has a confidence interval; the model is plotted over the raw points, not instead of them; and a curve that never reached its plateau is reported as "IC50 not estimable" rather than extrapolated.

## Installation

Shipped: `scipy` (`curve_fit`), `statsmodels`, `scikit-posthocs`, `r-drc`, `r-emmeans`, `r-rstatix`, `r-ggpubr`. Optional through `install_science_packages`:

| Need | Language | Spec |
|------|----------|------|
| Plate-reader parsing helpers / growth curves in R | r | `r-growthcurver` (conda-forge) |
| Robust nonlinear fits with profile-likelihood CIs | python | `lmfit` |
| Mixed models for plate/day random effects (Python) | python | `statsmodels` already has `MixedLM`; R uses shipped `lme4` |
| qPCR reference-gene stability (geNorm/NormFinder-like) | r | `bioconductor-normqpcr` (macOS) — or compute geNorm M with `scripts/qpcr.py` (shipped here, no install) |

Compatibility traps: `curve_fit` needs sensible `p0` and `bounds` for 4PL or it silently converges to a flat line — always pass `p0=[bottom≈min(y), top≈max(y), ic50≈geometric mean of x, hill=1]` and check `pcov` is finite. Concentrations must be fitted on **log10(x)**; a zero-dose control cannot be logged — keep it as a separate constraint (fix `top` or `bottom`) or plot it at a nominal low value and say so. `drc::drm` uses `LL.4()` with parameters `(b = hill slope with sign flipped, c = lower, d = upper, e = ED50 on the linear scale)`; `ED(fit, 50, interval = "delta")` gives the CI. In `2^-ΔΔCt`, a Ct of 40 or "Undetermined" is a non-detect, not a number — handle it explicitly.

## Workflow

1. **Reconstruct the experiment.** Plate layout (which wells are which condition), technical vs biological replicates, blanks/negative and positive controls, units, and dilution series. If the file is a raw plate matrix, reshape it to long form (`well, row, col, condition, dose, replicate, value`) and print the layout as a table for the user to confirm. Subtract blanks and normalize to controls only after saying how (percent of vehicle; `(x − min)/(max − min)`).
2. **Look before fitting.** Plot raw points per condition (log-x for doses, time-x for growth). Note saturation, incomplete curves, outliers, and edge-effects (rows A/H, columns 1/12 differ).
3. **Fit the right model** (below), on biological-replicate means or with replicate as a random effect; report parameters with 95 % CIs, R² or residual SD, and a plot of the fitted curve over the raw points with the estimate marked. `scripts/dose_response.py` and `scripts/growth_curves.py` implement the fits with CIs; `scripts/qpcr.py` implements ΔΔCt and Pfaffl.
4. **Compare conditions** with the appropriate test on the derived parameter (e.g. log IC50 or doubling time per biological replicate → t-test/ANOVA with emmeans/Tukey, or the F-test for nested curves in `drc::compParm`/`anova(fit_common, fit_separate)`). Never compare raw wells across treatments while ignoring the plate/day they came from; add `plate`/`day` as a blocking factor or random effect.
5. **Deliver.** `fits.csv` (parameters, CIs, fit statistics per condition), `replicates.csv` (per-biological-replicate derived values), and PNG figures declared in `raster_artifacts`; `annotate_artifact` the main curve figure with model and n.

## Models

**Dose–response (4PL / log-logistic)** — `y = bottom + (top − bottom) / (1 + 10^((logIC50 − log x) · hill))`. Report IC50/EC50 in the original units with CI (from the covariance of `logIC50`: back-transform the interval, never symmetrize on the linear scale), the Hill slope, and whether top/bottom were fixed (0/100 for normalized data). Relative vs absolute IC50: the relative (curve midpoint) is what 4PL gives; the absolute (50 % of control) needs the top fixed at 100 — state which. Curves with < 4 doses spanning the transition, or no plateau, do not support an IC50. For binary outcomes (dead/alive counts → LD50), use a logit/probit GLM (`statsmodels.GLM(Binomial)`, `drc::LL.2` with `type="binomial"`) and Fieller-type CIs.

**Growth curves** — logistic `N(t) = K / (1 + ((K − N0)/N0) e^{−r t})` or Gompertz (asymmetric); doubling time `ln 2 / r` from the exponential phase (log-linear fit on the window where log(OD) is linear, chosen by maximizing R² over sliding windows and printed), lag time (intercept of the tangent at max slope with the baseline), carrying capacity `K`, and AUC (trapezoid) as a model-free summary. Blank-subtract, then log-transform OD only for the exponential window; fit on the linear scale otherwise. Report the per-replicate doubling time and compare with ANOVA/emmeans.

**qPCR** — Efficiency from a standard curve: `E = 10^(−1/slope) − 1` (accept 90–110 %, R² ≥ 0.98). ΔCt = Ct_target − Ct_ref (geometric mean of ≥ 2 reference genes when available); ΔΔCt = ΔCt_sample − mean ΔCt_calibrator; fold = `2^−ΔΔCt` (or Pfaffl with per-gene efficiencies). Statistics are done on **ΔCt (or ΔΔCt) values**, not on fold changes; report fold change with 95 % CI back-transformed from the ΔΔCt interval, plot on a log2 axis. Technical replicate Ct SD > 0.5 → flag the well. Reference-gene stability: geNorm M < 0.5 (homogeneous samples) / 1.0 (heterogeneous).

**Standard curves (ELISA, BCA, Bradford, DNA)** — linear on the working range, or 4PL for sigmoidal ELISA; back-calculate unknowns with prediction intervals (`scripts/dose_response.py::inverse_predict`), flag values outside the calibrated range (never extrapolate above the top standard), apply dilution factors last, and report LOD/LOQ (mean blank + 3 SD / + 10 SD).

**Enzyme kinetics** — Michaelis–Menten `v = Vmax [S]/(Km + [S])` by nonlinear fit (`curve_fit`, `drc::MM.2`); Lineweaver–Burk is for display only, never for estimation. Inhibition mode by global fit of competitive/non-competitive/uncompetitive models and AIC comparison.

**Screening plates** — `Z′ = 1 − 3(σ_pos + σ_neg)/|μ_pos − μ_neg|`; Z′ ≥ 0.5 is assay-worthy. Normalize per plate (percent of controls or robust z-score with plate median/MAD), and show a plate heatmap to expose edge and gradient effects.

**Counts (colonies, plaques, cells)** — Poisson/negative-binomial GLM with log(volume or dilution) offset rather than t-tests on raw counts; report rate ratios.

## Integrity rules

1. **The n reported is biological replicates.** Wells on the same plate from the same culture are technical replicates; average them first.
2. **Fitted parameters come with CIs and the fit plotted over raw data.** A parameter table without a curve figure is not a result.
3. **No extrapolated IC50/EC50, LOD-limited concentration, or fold change from non-detects.** Say "not estimable" or "> highest dose tested".
4. **Normalization is disclosed**: blank subtraction, control definition, and any outlier removal with the rule (Grubbs/ROUT/none) and how many points it removed.
5. **Statistics on the right scale**: log IC50, ΔCt, log doubling time — not on the back-transformed values.
6. **Same model across compared conditions**, or a documented reason.
7. **Seeds and versions** for any bootstrap CI (`np.random.default_rng(0)`; `scipy.__version__`).

Files: `scripts/dose_response.py` (`fit_4pl`, `inverse_predict`, `plot_dose_response`), `scripts/qpcr.py` (`tidy_ct`, `ddct` — ΔΔCt or Pfaffl via `efficiencies=`, `genorm_m`, `efficiency_from_standard_curve`, and `fit_logistic` for growth curves with doubling time, lag, and AUC), `references/assay_qc.md` (acceptance criteria, plate effects, MIQE checklist, unit conversions).
