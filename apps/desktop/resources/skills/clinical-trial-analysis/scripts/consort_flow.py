"""CONSORT participant-flow counts and diagram.

    from consort_flow import consort_counts, draw_consort
    counts = consort_counts(df, arm="arm", randomized="randomized", received="received_tx",
                            completed="completed", analyzed="itt", screened_n=1250,
                            exclusion_reasons={"Not meeting criteria": 300, "Declined": 84})
    draw_consort(counts, os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "consort.png"))
Declare consort.png in raster_artifacts.
"""
from __future__ import annotations
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def consort_counts(df: pd.DataFrame, arm: str, randomized: str, received: str, completed: str,
                   analyzed: str, screened_n: int | None = None,
                   exclusion_reasons: dict[str, int] | None = None) -> dict:
    r = df[df[randomized].astype(bool)]
    arms = {}
    for a, sub in r.groupby(arm):
        arms[str(a)] = {
            "allocated": int(len(sub)),
            "received": int(sub[received].astype(bool).sum()),
            "lost": int(len(sub) - sub[completed].astype(bool).sum()),
            "analyzed": int(sub[analyzed].astype(bool).sum()),
        }
    out = {"screened": screened_n, "randomized": int(len(r)), "arms": arms,
           "exclusion_reasons": exclusion_reasons or {}}
    for k, v in out.items():
        print(k, v)
    return out


def _box(ax, x, y, text, w=0.42, h=0.11):
    ax.add_patch(plt.Rectangle((x - w / 2, y - h / 2), w, h, fill=False, lw=1.2))
    ax.text(x, y, text, ha="center", va="center", fontsize=9)


def draw_consort(counts: dict, path: str) -> None:
    fig, ax = plt.subplots(figsize=(8, 10))
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    if counts.get("screened") is not None:
        _box(ax, 0.5, 0.93, f"Assessed for eligibility (n={counts['screened']})")
        excl = counts["screened"] - counts["randomized"]
        reasons = "\n".join(f"{k} (n={v})" for k, v in counts["exclusion_reasons"].items())
        _box(ax, 0.8, 0.82, f"Excluded (n={excl})\n{reasons}", w=0.36, h=0.14)
        ax.annotate("", xy=(0.5, 0.775), xytext=(0.5, 0.875), arrowprops=dict(arrowstyle="->"))
    _box(ax, 0.5, 0.72, f"Randomized (n={counts['randomized']})")
    arms = list(counts["arms"].items())
    xs = [0.27, 0.73] if len(arms) == 2 else [0.5 + (i - (len(arms) - 1) / 2) * 0.3 for i in range(len(arms))]
    for (name, a), x in zip(arms, xs):
        ax.annotate("", xy=(x, 0.6), xytext=(0.5, 0.665), arrowprops=dict(arrowstyle="->"))
        _box(ax, x, 0.55, f"Allocated to {name} (n={a['allocated']})\nReceived intervention (n={a['received']})", w=0.4, h=0.12)
        ax.annotate("", xy=(x, 0.4), xytext=(x, 0.49), arrowprops=dict(arrowstyle="->"))
        _box(ax, x, 0.35, f"Lost to follow-up / discontinued (n={a['lost']})", w=0.4)
        ax.annotate("", xy=(x, 0.2), xytext=(x, 0.295), arrowprops=dict(arrowstyle="->"))
        _box(ax, x, 0.15, f"Analyzed (n={a['analyzed']})\nExcluded from analysis (n={a['allocated']-a['analyzed']})", w=0.4, h=0.12)
    for y, lab in [(0.93, "Enrollment"), (0.55, "Allocation"), (0.35, "Follow-up"), (0.15, "Analysis")]:
        ax.text(0.02, y, lab, rotation=90, va="center", fontsize=10, fontweight="bold")
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)
