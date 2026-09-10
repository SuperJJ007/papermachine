# Data extraction conversions

| Reported | Convert to | Formula |
|---|---|---|
| Median, IQR (q1, q3), n | mean ≈ (q1 + m + q3)/3; SD ≈ (q3 − q1)/1.35 | Wan et al. 2014 (use `estmeansd` in R for skewed data) |
| Median, min, max, n | mean ≈ (min + 2m + max)/4; SD ≈ range/4 (n>70: range/6) | Hozo 2005 / Wan 2014 |
| 95% CI of mean | SE = (upper − lower)/3.92; SD = SE × √n | for t-based CI with small n use t quantile |
| SE | SD = SE × √n | |
| p-value & n (two-sample) | t = qt(1 − p/2, df); SE = MD/t | last resort |
| HR with CI | log HR, SE = (ln upper − ln lower)/3.92 | Tierney 2007 for KM-curve extraction |
| Change score without SD | SD_change = √(SD_b² + SD_f² − 2·r·SD_b·SD_f), r ≈ 0.5 | report imputed r, sensitivity r = 0.3/0.7 |
| OR and RR | do not mix; convert OR→RR only with baseline risk (Zhang & Yu 1998) | |

Always list which studies received which conversion in a footnote column `conversion_note`.
