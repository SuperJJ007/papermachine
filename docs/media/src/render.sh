#!/bin/sh
# 用法:把截图存成本目录的 pm.png,然后 sh render.sh [palette] [term_style]
# palette: blue(默认) | emerald | violet | ember;term_style(等式行配色): gold(默认) | mint | solid
# 输出:docs/media/hero.png(英文)、hero.zh.png(中文)、hero-bg.png(纯背景)
set -e
cd "$(dirname "$0")"
PALETTE="${1:-blue}"
TERMS="${2:-gold}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
python3 gen-hero.py "$PALETTE" "$TERMS" >/dev/null
"$CHROME" --headless --disable-gpu --force-device-scale-factor=2 --hide-scrollbars \
  --window-size=1280,640 --screenshot=../hero.png "file://$PWD/hero.html" 2>/dev/null
"$CHROME" --headless --disable-gpu --force-device-scale-factor=2 --hide-scrollbars \
  --window-size=1280,640 --screenshot=../hero.zh.png "file://$PWD/hero.zh.html" 2>/dev/null
"$CHROME" --headless --disable-gpu --force-device-scale-factor=2 --hide-scrollbars \
  --window-size=1280,640 --screenshot=../hero-bg.png "file://$PWD/bg.html" 2>/dev/null
echo "done ($PALETTE): docs/media/hero.png + hero.zh.png"
