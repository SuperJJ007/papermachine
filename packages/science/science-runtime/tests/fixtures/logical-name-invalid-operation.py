import os
from pathlib import Path
root = Path(os.environ["SCIENCE_ARTIFACT_DIR"])
(root / "a.csv").write_text("valid candidate\n", encoding="utf-8")
(root / "z:stream.csv").write_text("invalid candidate\n", encoding="utf-8")
print("SCIENCE_PYTHON_SUCCEEDED_CAPTURE_INVALID")
