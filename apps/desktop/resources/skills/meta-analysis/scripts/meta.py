"""Study-level meta-analysis in pure numpy/scipy.

    from meta import escalc_binary, escalc_continuous, meta_analysis, forest_plot, funnel_plot, egger_test, leave_one_out
    es = escalc_binary(df, measure="RR")          # adds yi (log RR) and vi
    res = meta_analysis(es, method="REML", hk=True, exp=True)
    forest_plot(es, res, png=..., exp=True, xlabel="Risk ratio")
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import brentq
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def escalc_binary(df, measure="RR", cc=0.5):
    d = df.copy()
    a, b = d.events_t.astype(float), (d.n_t - d.events_t).astype(float)
    c, dd = d.events_c.astype(float), (d.n_c - d.events_c).astype(float)
    zero = (a == 0) | (b == 0) | (c == 0) | (dd == 0)
    if zero.any():
        print(f"Continuity correction {cc} applied to {int(zero.sum())} studies with a zero cell.")
    a, b, c, dd = [x + cc * zero for x in (a, b, c, dd)]
    if measure == "OR":
        d["yi"] = np.log((a * dd) / (b * c)); d["vi"] = 1 / a + 1 / b + 1 / c + 1 / dd
    elif measure == "RR":
        d["yi"] = np.log((a / (a + b)) / (c / (c + dd))); d["vi"] = 1 / a - 1 / (a + b) + 1 / c - 1 / (c + dd)
    elif measure == "RD":
        p1, p0 = a / (a + b), c / (c + dd)
        d["yi"] = p1 - p0; d["vi"] = p1 * (1 - p1) / (a + b) + p0 * (1 - p0) / (c + dd)
    else:
        raise ValueError(measure)
    return d


def escalc_continuous(df, measure="SMD"):
    d = df.copy()
    n1, n2 = d.n_t.astype(float), d.n_c.astype(float)
    if measure == "MD":
        d["yi"] = d.mean_t - d.mean_c; d["vi"] = d.sd_t ** 2 / n1 + d.sd_c ** 2 / n2
    else:  # Hedges' g
        sp = np.sqrt(((n1 - 1) * d.sd_t ** 2 + (n2 - 1) * d.sd_c ** 2) / (n1 + n2 - 2))
        J = 1 - 3 / (4 * (n1 + n2) - 9)
        g = J * (d.mean_t - d.mean_c) / sp
        d["yi"] = g; d["vi"] = (n1 + n2) / (n1 * n2) + g ** 2 / (2 * (n1 + n2))
    return d


def _tau2_dl(y, v):
    w = 1 / v; mu = np.sum(w * y) / np.sum(w)
    Q = np.sum(w * (y - mu) ** 2); k = len(y)
    C = np.sum(w) - np.sum(w ** 2) / np.sum(w)
    return max(0.0, (Q - (k - 1)) / C), Q


def _tau2_reml(y, v, tol=1e-8):
    k = len(y)
    def score(t2):
        w = 1 / (v + t2); mu = np.sum(w * y) / np.sum(w)
        return np.sum(w ** 2 * ((y - mu) ** 2 - v)) - np.sum(w ** 2) / np.sum(w) * 0 - 0  # simplified
    def reml_ll(t2):
        w = 1 / (v + t2); mu = np.sum(w * y) / np.sum(w)
        return -0.5 * (np.sum(np.log(v + t2)) + np.log(np.sum(w)) + np.sum(w * (y - mu) ** 2))
    grid = np.linspace(0, max(10 * np.var(y), 1e-6), 400)
    t2 = grid[np.argmax([reml_ll(t) for t in grid])]
    lo, hi = max(0, t2 - grid[1]), t2 + grid[1]
    from scipy.optimize import minimize_scalar
    r = minimize_scalar(lambda t: -reml_ll(t), bounds=(lo, hi), method="bounded")
    return float(max(0.0, r.x))


def meta_analysis(es: pd.DataFrame, method="REML", hk=True, exp=False, alpha=0.05):
    y, v = es.yi.values.astype(float), es.vi.values.astype(float); k = len(y)
    w_fe = 1 / v; mu_fe = np.sum(w_fe * y) / np.sum(w_fe); se_fe = np.sqrt(1 / np.sum(w_fe))
    tau2_dl, Q = _tau2_dl(y, v)
    tau2 = tau2_dl if method == "DL" else _tau2_reml(y, v)
    w = 1 / (v + tau2); mu = np.sum(w * y) / np.sum(w); se = np.sqrt(1 / np.sum(w))
    df_ = k - 1
    if hk and k > 2:
        q_hk = np.sum(w * (y - mu) ** 2) / df_
        se = np.sqrt(max(q_hk, 1.0) * se ** 2) if False else np.sqrt(q_hk / np.sum(w))
        crit = stats.t.ppf(1 - alpha / 2, df_); p = 2 * stats.t.sf(abs(mu / se), df_)
    else:
        crit = stats.norm.ppf(1 - alpha / 2); p = 2 * stats.norm.sf(abs(mu / se))
    ci = (mu - crit * se, mu + crit * se)
    p_Q = stats.chi2.sf(Q, df_); I2 = max(0, (Q - df_) / Q) * 100 if Q > 0 else 0.0
    H2 = Q / df_ if df_ > 0 else np.nan
    # I² CI via Higgins & Thompson test-based method
    if Q > df_ and df_ > 0:
        B = 0.5 * (np.log(Q) - np.log(df_)) / (np.sqrt(2 * Q) - np.sqrt(2 * df_ - 1))
    else:
        B = np.sqrt(1 / (2 * (df_ - 1) * (1 - 1 / (3 * (df_ - 1) ** 2)))) if df_ > 1 else np.nan
    lnH = 0.5 * np.log(H2) if H2 > 0 else 0
    H_lo, H_hi = np.exp(lnH - 1.96 * B), np.exp(lnH + 1.96 * B)
    I2_ci = (max(0, (H_lo ** 2 - 1) / H_lo ** 2) * 100, max(0, (H_hi ** 2 - 1) / H_hi ** 2) * 100) if not np.isnan(B) else (np.nan, np.nan)
    pi_crit = stats.t.ppf(1 - alpha / 2, k - 2) if k > 2 else np.nan
    pi = (mu - pi_crit * np.sqrt(tau2 + se ** 2), mu + pi_crit * np.sqrt(tau2 + se ** 2))
    f = np.exp if exp else (lambda x: x)
    res = {"k": k, "fe": (f(mu_fe), f(mu_fe - 1.96 * se_fe), f(mu_fe + 1.96 * se_fe)),
           "re": (f(mu), f(ci[0]), f(ci[1])), "p": p, "tau2": tau2, "Q": Q, "p_Q": p_Q, "I2": I2, "I2_ci": I2_ci,
           "pi": (f(pi[0]), f(pi[1])), "weights": w / w.sum() * 100, "mu_raw": mu, "se_raw": se, "method": method, "hk": hk}
    print(f"k = {k} studies")
    print(f"Fixed effect:  {res['fe'][0]:.3f} (95% CI {res['fe'][1]:.3f}–{res['fe'][2]:.3f})")
    print(f"Random effects ({method}{', HK' if hk else ''}): {res['re'][0]:.3f} (95% CI {res['re'][1]:.3f}–{res['re'][2]:.3f}), p = {p:.4f}")
    print(f"Heterogeneity: Q = {Q:.2f} (df = {df_}, p = {p_Q:.4f}); I² = {I2:.1f}% (95% CI {I2_ci[0]:.0f}–{I2_ci[1]:.0f}%); τ² = {tau2:.4f}")
    print(f"95% prediction interval: {res['pi'][0]:.3f} to {res['pi'][1]:.3f}")
    return res


def forest_plot(es, res, png, exp=False, xlabel="Effect", label_col="study"):
    y, v = es.yi.values, es.vi.values; k = len(y)
    f = np.exp if exp else (lambda x: x)
    fig, ax = plt.subplots(figsize=(9, 0.4 * k + 2.5))
    ys = np.arange(k)[::-1] + 2
    lo, hi = f(y - 1.96 * np.sqrt(v)), f(y + 1.96 * np.sqrt(v))
    ax.errorbar(f(y), ys, xerr=[f(y) - lo, hi - f(y)], fmt="none", ecolor="black", capsize=2)
    ax.scatter(f(y), ys, s=res["weights"] * 8 + 10, marker="s", color="steelblue", zorder=3)
    labels = [f"{s}  {f(yy):.2f} [{l:.2f}, {h:.2f}]  {w:.1f}%" for s, yy, l, h, w in zip(es[label_col], y, lo, hi, res["weights"])]
    m, l, h = res["re"]
    ax.fill([l, m, h, m], [1, 1.3, 1, 0.7], color="black")
    ax.plot(res["pi"], [0.2, 0.2], color="red", lw=3)
    ax.set_yticks(list(ys) + [1, 0.2]); ax.set_yticklabels(labels + [f"RE model  {m:.2f} [{l:.2f}, {h:.2f}]", f"Prediction interval [{res['pi'][0]:.2f}, {res['pi'][1]:.2f}]"], fontsize=8)
    ax.axvline(1 if exp else 0, ls="--", color="grey")
    if exp: ax.set_xscale("log")
    ax.set_xlabel(xlabel); ax.set_title(f"I² = {res['I2']:.0f}%, τ² = {res['tau2']:.3f}, p = {res['p']:.3f}")
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)


def egger_test(es):
    y, se = es.yi.values, np.sqrt(es.vi.values)
    X = np.column_stack([np.ones_like(se), 1 / se]); Y = y / se
    beta, *_ = np.linalg.lstsq(X, Y, rcond=None)
    resid = Y - X @ beta; s2 = resid @ resid / (len(y) - 2)
    cov = s2 * np.linalg.inv(X.T @ X); t = beta[0] / np.sqrt(cov[0, 0]); p = 2 * stats.t.sf(abs(t), len(y) - 2)
    print(f"Egger's test: intercept = {beta[0]:.3f}, t = {t:.2f}, p = {p:.4f}" + ("  (k < 10: underpowered)" if len(y) < 10 else ""))
    return {"intercept": beta[0], "t": t, "p": p}


def funnel_plot(es, res, png, exp=False, xlabel="Effect"):
    y, se = es.yi.values, np.sqrt(es.vi.values)
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.scatter(y, se, color="steelblue")
    mu = res["mu_raw"]; s = np.linspace(0, se.max() * 1.05, 50)
    ax.plot(mu - 1.96 * s, s, "--", color="grey"); ax.plot(mu + 1.96 * s, s, "--", color="grey"); ax.axvline(mu, color="black")
    ax.invert_yaxis(); ax.set_xlabel(f"{xlabel} (log scale)" if exp else xlabel); ax.set_ylabel("Standard error"); ax.set_title("Funnel plot")
    fig.savefig(png, dpi=200, bbox_inches="tight"); plt.close(fig)


def leave_one_out(es, exp=False, **kw):
    rows = []
    for i in range(len(es)):
        sub = es.drop(es.index[i])
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            r = meta_analysis(sub, exp=exp, **kw)
        rows.append({"omitted": es.iloc[i].get("study", i), "estimate": r["re"][0], "lo": r["re"][1], "hi": r["re"][2], "I2": r["I2"]})
    out = pd.DataFrame(rows); print(out.round(3).to_string(index=False)); return out


def meta_regression(es, moderator: str, method="REML"):
    y, v = es.yi.values, es.vi.values; x = es[moderator].values.astype(float)
    tau2 = _tau2_reml(y, v); w = 1 / (v + tau2)
    X = np.column_stack([np.ones_like(x), x]); W = np.diag(w)
    beta = np.linalg.solve(X.T @ W @ X, X.T @ W @ y); cov = np.linalg.inv(X.T @ W @ X)
    se = np.sqrt(np.diag(cov)); z = beta / se; p = 2 * stats.norm.sf(abs(z))
    print(f"Meta-regression on {moderator}: slope = {beta[1]:.4f} (SE {se[1]:.4f}), z = {z[1]:.2f}, p = {p[1]:.4f}; k = {len(y)}" + ("  ⚠ <10 studies" if len(y) < 10 else ""))
    return {"beta": beta, "se": se, "p": p}
