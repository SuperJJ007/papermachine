---
name: meta-analysis
description: "Meta分析 / 荟萃分析。OR/RR/RD/MD/SMD 合并、异质性、森林图、漏斗图、GRADE、PRISMA 2020。触发: 森林图、漏斗图、合并效应量、发表偏倚。Use to pool study-level effect sizes or when the user says forest plot or heterogeneity."
license: MIT license
metadata:
  version: "1.0"
  skill-author: PaperMachine Medical Extension Pack
  domain: medicine
  reporting-guideline: PRISMA 2020
---

# Meta-Analysis

Pool study-level effects through `run_python` (`scripts/meta.py`, pure numpy/scipy — no extra install) or `run_r` (`meta`, `metafor` — the reference implementation for anything beyond the basics).

## Installation

Python: nothing beyond the base environment. R via `install_science_packages`: `r-meta`, `r-metafor`, `r-dmetar` (optional). The `biomedical` environment ships `r-meta` and `r-metafor`.

## Workflow

1. **Extract into a tidy table** — one row per study: `study, year, n_t, events_t, n_c, events_c` (binary); `n_t, mean_t, sd_t, n_c, mean_c, sd_c` (continuous); or `log_hr, se_log_hr` (survival). Convert medians/IQR or CIs to SD when necessary (`references/data_extraction.md`) and say which studies were converted.
2. **Choose the effect measure** before pooling: RR for trials with common events, OR for case-control, MD when scales are identical, SMD (Hedges' g) otherwise, HR for time-to-event. Zero-event arms: continuity correction 0.5 (report), or Peto OR / Mantel-Haenszel without correction for rare events.
3. **Pool.** Default to a **random-effects** model with REML τ² and **Hartung-Knapp** adjustment when k ≥ 5 (`scripts/meta.py::meta_analysis(method="REML", hk=True)`); report the fixed-effect estimate alongside for transparency. With k < 5, say the τ² estimate is unstable.
4. **Quantify heterogeneity**: Q (p), I² with CI, τ², and the **95% prediction interval** — the interval a new study's effect is expected to fall in. I² alone is not enough.
5. **Forest plot** (`meta.py::forest_plot`) with study weights, individual CIs, the pooled diamond, and the prediction interval bar. Declare the PNG in `raster_artifacts`.
6. **Explore heterogeneity** only if pre-specified: subgroup analysis with a test for subgroup differences; meta-regression (`meta.py::meta_regression`) needs ≥10 studies per covariate.
7. **Small-study effects / publication bias**: funnel plot; Egger's test (continuous, or binary with ≥10 studies; Harbord/Peters for binary), trim-and-fill as a sensitivity analysis. Below 10 studies say tests are underpowered.
8. **Sensitivity**: leave-one-out, exclude high risk-of-bias studies, fixed vs random, alternative τ² estimators.
9. **Report** per PRISMA 2020 (`references/prisma_grade.md`): flow counts, pooled estimate with CI and PI, heterogeneity statistics, bias assessment, GRADE certainty per outcome.

## Key Rules

- Random-effects weights are more equal than fixed-effect weights; a random-effects pooled estimate may be pulled toward small studies — say so if the two models disagree materially.
- Do not pool adjusted and unadjusted estimates from observational studies without a sensitivity analysis.
- Do not compute a p-value for I²; report its CI.
- Report the prediction interval whenever τ² > 0.
- Never present "no publication bias" from a test with k < 10; state the limitation.

## Resources

- `scripts/meta.py` — effect-size computation, FE/RE pooling (DL, REML, HK), heterogeneity, prediction interval, forest & funnel plots, Egger, leave-one-out, meta-regression.
- `references/data_extraction.md` — conversion formulas (median/IQR → mean/SD, CI → SE, change scores).
- `references/prisma_grade.md` — PRISMA 2020 flow and GRADE domains.
