import os
from pathlib import Path
root = Path(os.environ["SCIENCE_ARTIFACT_DIR"])
for name in ["_probe/p.csv", "中文 数据/结果.csv"]:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("x,y\n1,2\n", encoding="utf-8")
print("SCIENCE_LOGICAL_NAMES_OK")
