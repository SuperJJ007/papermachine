import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(3, 2), dpi=80)
ax.plot([0, 1, 2], [0, 1, 4])
ax.set_title("Science snapshot")
fig.savefig(os.path.join(os.environ["SCIENCE_ARTIFACT_DIR"], "plot.png"), metadata={"Software": "Science snapshot"})
print("SCIENCE_SNAPSHOT_RUN_OK")
