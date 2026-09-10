# TRIPOD+AI — official scope and working map

**Official statement:** Collins GS, Moons KGM, Dhiman P, et al. TRIPOD+AI statement: updated guidance for reporting clinical prediction models that use regression or machine learning methods. *BMJ* 2024;385:e078378. doi:10.1136/bmj-2023-078378

**Official scope** (from the TRIPOD group): a **27-item** checklist (52 subitems) for studies that **develop, evaluate (validate), or update** a multivariable prediction model, whether the methods are regression or machine learning, and whether the model is used for diagnosis, prognosis, monitoring or screening, irrespective of medical domain, outcome, or predictors. TRIPOD 2015 is superseded and should no longer be used.

This file is a **navigational map**, not the fillable publisher checklist. Before submission, complete [Supplementary Table 2](https://www.bmj.com/content/385/bmj-2023-078378) / the PDF on [tripod-statement.org](https://www.tripod-statement.org/). The reporting-checklist tool key `TRIPOD` stores the 27 main items and their subitems as a self-reported working map.

## 27 main items

| Item | Section | Official topic |
|---|---|---|
| 1 | Title | Development or evaluation, target population, outcome |
| 2 | Abstract | TRIPOD+AI for Abstracts (13 items; not expanded here) |
| 3 | Introduction | Context (3a), intended use/users (3b), health inequalities (3c) |
| 4 | Introduction | Objectives: development, evaluation, or both |
| 5 | Methods | Data sources and representativeness (5a); dates (5b) |
| 6 | Methods | Setting (6a); eligibility (6b); treatments received (6c) |
| 7 | Methods | Pre-processing and quality checking |
| 8 | Methods | Outcome definition, horizon, assessment, blinding (8a–8b) |
| 9 | Methods | Predictor choice, definition, processing (9a–9c) |
| 10 | Methods | Sample size justification (Riley criteria for development) |
| 11 | Methods | Missing data |
| 12 | Methods | Partitioning (12a), predictor handling (12b), model type and internal validation (12c), clustering (12d), performance measures (12e), updating (12f), how predictions are calculated (12g) |
| 13 | Methods | Class imbalance methods and any recalibration |
| 14 | Methods | Fairness approaches |
| 15 | Methods | Model output and thresholds |
| 16 | Methods | Differences between development and evaluation data |
| 17 | Methods | Ethics approval and consent |
| 18 | Open science | Funding (18a), conflicts (18b), protocol (18c), registration (18d), data (18e), code (18f), model (18g) |
| 19 | PPI | Patient and public involvement, or state none |
| 20 | Results | Flow (20a), characteristics (20b), n and events per analysis (20c) |
| 21 | Results | Full model specification so others can predict |
| 22 | Results | Performance with CIs and plots, including sociodemographic groups if assessed |
| 23 | Results | Model updating (23a) and subsequent performance (23b) |
| 24 | Results | Fairness evaluation results if done |
| 25 | Discussion | Interpretation, including fairness, vs intended use |
| 26 | Discussion | Limitations of study and model |
| 27 | Discussion | Potential use (27a), practice implications (27b), next research steps (27c) |

## Analysis outputs that commonly feed the map

- Sample size: Riley three criteria (`riley_sample_size`), events, EPV.
- Missing data: method, m, variables in the imputation model.
- Predictors: continuous kept continuous; no univariable screening.
- Internal validation: bootstrap B, success/failure counts, optimism-corrected AUC/C, calibration slope/CITL/O:E, DCA.
- Full equation / coefficients / baseline hazard / serialized model.
- Fairness: performance across pre-specified sociodemographic groups, or an explicit reason it was not done.
