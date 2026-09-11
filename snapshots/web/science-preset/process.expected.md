## Empty arguments

- region "Input arguments": "Input arguments {}"

## Run details

- region "Python run":
  - heading "Python run" [level=4]
  - paragraph: "Kernel #1 · Environment revision 1"
  - region "Code":
    - text: Code python
    - button "Copy"
    - code: "import os import matplotlib matplotlib.use(\"Agg\") import matplotlib.pyplot as plt fig, ax = plt.subplots(figsize=(3, 2), dpi=80) ax.plot([0, 1, 2], [0, 1, 4]) ax.set_title(\"Science snapshot\") fig.savefig(os.path.join(os.environ[\"SCIENCE_ARTIFACT_DIR\"], \"plot.png\"), metadata={\"Software\": \"Science snapshot\"}) print(\"SCIENCE_SNAPSHOT_RUN_OK\")"
  - region "Input arguments": "Input arguments { \"raster_artifacts\": [ \"plot.png\" ] }"
  - region "Standard output": Standard output SCIENCE_SNAPSHOT_RUN_OK
  - region "Error output": Error output (empty)
  - group: Full tool result
  - paragraph: Stdout 24 bytes · Stderr 0 bytes
