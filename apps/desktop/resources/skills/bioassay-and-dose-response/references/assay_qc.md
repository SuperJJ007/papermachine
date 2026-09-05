# Assay QC, acceptance criteria, and reporting checklists

## Acceptance criteria (state them, then apply them)

| Assay | Criterion | Typical threshold |
|-------|-----------|-------------------|
| Any plate | Z′-factor from positive/negative controls | ≥ 0.5 good; 0–0.5 marginal; < 0 unusable |
| Any plate | CV of replicate wells | ≤ 15 % (≤ 20 % near LOQ) |
| Dose–response | Doses spanning both plateaus, ≥ 6 concentrations, ≥ 3 biological replicates | IC50 inside the tested range; Hill slope 0.5–3 plausible |
| qPCR | Efficiency 90–110 %, standard-curve R² ≥ 0.98, technical Ct SD ≤ 0.5, NTC Ct ≥ 35 or undetermined, single melt peak | Reference genes geNorm M < 0.5 (1.0 heterogeneous) |
| ELISA / standard curve | Back-calculated standards within ±20 % of nominal (±25 % at LLOQ), 4PL R² ≥ 0.99 | Unknowns inside the calibrated range |
| Growth curves | Blank OD stable; ≥ 5 points in exponential phase; R² of log-linear window ≥ 0.98 | Doubling time reported per replicate |
| Western blot | Loading-control band in the linear range (check a dilution series once), same membrane for compared lanes | Normalize to total protein where possible |
| Counts | ≥ 30 and ≤ 300 colonies per plate (or the countable range for the organism) | Use plates within range only |

## Plate and day effects

- Edge wells evaporate: rows A/H and columns 1/12 read differently. Plot a plate heatmap of raw values; if edges deviate, exclude them or include `edge` as a covariate — and say so.
- Day-to-day and plate-to-plate offsets are real: normalize within plate to that plate's controls, then analyze biological replicates as blocks (`plate`/`day` as a random effect in `MixedLM`/`lmer`, or as a factor in ANOVA).
- Gradients (temperature, pipetting order) show up as smooth trends across columns; randomized layouts prevent confounding with treatment — note when the layout was not randomized.

## Outliers

Decide the rule before looking at which points are inconvenient: Grubbs (single outlier, normal data), ROUT (robust regression, Q = 1 %), or none. Report the rule and the number removed; keep removed points visible (hollow markers) in the figure.

## MIQE-style qPCR reporting (minimum)

Sample type and RNA extraction; RNA integrity (RIN) if measured; reverse-transcription kit and input; primer sequences or assay IDs and amplicon sizes; efficiency and R² per assay; reference genes and their stability metric; number of biological and technical replicates; Ct threshold method; how non-detects were handled; the statistical test and on which scale (ΔCt).

## Units and conversions

- Molarity ↔ mass: `conc (µM) = mass_conc (µg/mL) / MW (g/mol) × 1000`.
- OD600 → cells/mL is strain- and instrument-specific (E. coli ≈ 8 × 10⁸ cells/mL per OD unit as a rough default) — report OD, convert only with a calibration.
- Serial dilutions: concentration at step k = C₀ / f^k; log10 spacing = log10(f).
- Percent inhibition = 100 × (1 − (x − neg)/(pos − neg)) with `neg` = no-inhibition control and `pos` = full-inhibition control.

## Figure conventions

Dose–response: log-x, points as mean ± SD with n in the legend, fitted curve, IC50 with CI marked; separate panels per experiment day if curves are pooled. Growth: linear-y OD and a log-y inset or second panel showing the exponential window used. qPCR: log2 fold-change axis, individual biological replicates as points over bars or as a dot plot, calibrator at 1. Standard curve: standards, fitted curve with the calibrated range shaded, unknowns marked, extrapolated unknowns hollow.
