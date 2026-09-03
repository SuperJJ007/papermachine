# Library Result Frames

**Rule:** before indexing a result frame or object from a call you have not used in this session, print `result.columns` (pandas/pingouin) or an attribute list (scipy.stats), or `str(result)` in R, and index by the name it actually reports. Column and attribute names differ across libraries and versions, and guessing wastes a run.

Verified against the shipped desktop environment: pingouin 0.6.1, scipy 1.16.3, statsmodels 0.14.6.

## pingouin

| Call | `result.columns` |
|---|---|
| `pg.ttest(a, b)` | `T`, `dof`, `alternative`, `p_val`, `CI95`, `cohen_d`, `power`, `BF10` |
| `pg.mwu(a, b)` | `U_val`, `alternative`, `p_val`, `RBC`, `CLES` |
| `pg.wilcoxon(a, b)` | `W_val`, `alternative`, `p_val`, `RBC`, `CLES` |
| `pg.anova(data=df, dv=..., between=...)` | `Source`, `ddof1`, `ddof2`, `F`, `p_unc`, `np2` |
| `pg.pairwise_tests(data=df, dv=..., between=...)` | `Contrast`, `A`, `B`, `Paired`, `Parametric`, `T`, `dof`, `alternative`, `p_unc`, `BF10`, `hedges` |
| `pg.corr(a, b)` | `n`, `r`, `CI95`, `p_val`, `BF10`, `power` |

`p_val`/`p_unc` distinguish a corrected/testable p-value column (`ttest`, `mwu`, `wilcoxon`, `corr`) from an uncorrected one (`anova`, `pairwise_tests`) — index the one the call actually returns, never assume `p_val` everywhere.

## scipy.stats

Most `scipy.stats` test functions return a `namedtuple`-like result object; read fields as attributes (`result.statistic`), not `result['statistic']` or positional indexing beyond the first two.

| Call | Fields |
|---|---|
| `stats.ttest_ind(a, b)` | `.statistic`, `.pvalue`, `.df`, `.confidence_interval()` → object with `.low`, `.high` |
| `stats.mannwhitneyu(a, b)` | `.statistic`, `.pvalue` |
| `stats.wilcoxon(a, b)` | `.statistic`, `.pvalue` |
| `stats.f_oneway(*groups)` | `.statistic`, `.pvalue` |
| `stats.kruskal(*groups)` | `.statistic`, `.pvalue` |
| `stats.shapiro(a)` | `.statistic`, `.pvalue` |
| `stats.levene(a, b)` | `.statistic`, `.pvalue` |
| `stats.pearsonr(a, b)` | `.statistic` (the correlation), `.pvalue`, `.confidence_interval()` → `.low`, `.high` |
| `stats.spearmanr(a, b)` | `.statistic`, `.pvalue` |
| `stats.chi2_contingency(table)` | `.statistic`, `.pvalue`, `.dof`, `.expected_freq` |

`pearsonr`'s correlation coefficient is `.statistic`, not `.correlation` or `.rvalue`. Only `ttest_ind` and `pearsonr` results carry `confidence_interval()` among the calls above; the others do not.

## statsmodels

`model.summary2().tables` is a list of three DataFrames, index `[0]`/`[1]`/`[2]`, not named:

- `tables[0]` — overview (model, R², AIC/BIC, F-statistic); label/value pairs in unlabeled integer columns.
- `tables[1]` — the coefficient table, columns `Coef.`, `Std.Err.`, `t`, `P>|t|`, `[0.025`, `0.975]`.
- `tables[2]` — residual diagnostics (Omnibus, Durbin-Watson, Jarque-Bera, condition number); label/value pairs in unlabeled integer columns.

Read a coefficient or its p-value from `tables[1]`, e.g. `model.summary2().tables[1]['P>|t|']`.
