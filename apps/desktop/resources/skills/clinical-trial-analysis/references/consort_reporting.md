# CONSORT 2025 items the analysis must supply

Default reporting target is **CONSORT 2025** (Hopewell et al. *BMJ* 2025;388:e081123). CONSORT 2010 remains only for historical manuscripts (`CONSORT_2010`). This table maps analysis outputs onto 2025 item numbers; it is not the fillable publisher checklist.

| 2025 item | What to output |
|---|---|
| 2–4 Open science | Registry ID with URL and date; protocol and SAP location; data/code sharing statement |
| 8 Patient and public involvement | What patients/public did in design, conduct, reporting — or that they were not involved |
| 9 Design | Parallel/crossover, allocation ratio, superiority vs NI vs exploratory |
| 13 Intervention | Enough detail to replicate; link to manual/TIDieR materials |
| 14 Outcomes | Variable, metric, aggregation, time point for every prespecified outcome |
| 15 Harms methods | How harms were defined and whether collection was systematic |
| 16a/b Sample size | All assumptions; interim analyses and stopping rules |
| 21a–d Analysis | Primary model; who is in each population (ITT/PP/safety); missing-data method; prespecified vs post hoc extras |
| 22a/b Participant flow | CONSORT diagram (`consort_flow.py`), numbers analysed per arm, losses with reasons |
| 23a Recruitment dates | First enrolment to last follow-up for benefits and harms |
| 24 As administered | Fidelity, adherence, who delivered the intervention |
| 25 Baseline data | Table 1 with SMD (`table_one.py`), no p-values |
| 26 Outcomes & estimation | n analysed, n with data at the time point, effect size with 95% CI; binary outcomes need absolute and relative effects (`binary_effects.py`) |
| 27 Harms | AE table by arm; SAE; discontinuations due to AE |
| 28 Ancillary analyses | Subgroup forest with interaction p; label pre-specified vs exploratory |
| 29–30 Discussion | Interpretation balancing benefits/harms; limitations including bias, imprecision, generalisability, multiplicity |

## Checklist sentence stubs

- "Analyses were performed according to a pre-specified statistical analysis plan (version X, dated Y)."
- "Baseline characteristics were compared descriptively using standardized mean differences."
- "The primary analysis used the intention-to-treat population, defined as all randomized participants."
- "Missing primary-outcome data were handled by [MMRM with unstructured residual covariance under MAR / multiple imputation (m = 50)]; sensitivity analyses used [tipping point / jump-to-reference]."
- "Subgroup analyses were pre-specified; heterogeneity was assessed by treatment-by-subgroup interaction terms."
