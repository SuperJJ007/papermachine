"""Regenerate deterministic browser reference fixtures with the shipped matplotlib adapter."""
import importlib.util
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[5]
output = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('chart_adapter', root / 'packages/science/science-runtime/assets/chart_matplotlib.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
os.environ['SCIENCE_ARTIFACT_DIR'] = str(output)
charts = {}
adapter.install_savefig_hook(lambda name, entry: charts.__setitem__(name, entry))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

fig, ax = plt.subplots(figsize=(8, 4.8))
x = np.linspace(0, 1, 300)
for mean, color, name in [(0.14, '#006ba2', r'$\alpha$ No exposure'), (0.34, '#ebb434', r'$\beta$ LLM exposure'), (0.55, '#db444b', r'$\gamma$ LLM + other technology')]:
    y = np.exp(-((x-mean)/0.1)**2)
    ax.plot(x, y, color=color, label=name)
    ax.fill_between(x, y, color=color, alpha=0.15)
    ax.text(mean, 1.06, f'Mean {mean:.2f}', color=color, ha='center')
ax.set(title='Synthetic reference fixture', xlabel='Exposure', ylabel='Density', ylim=(0, 1.35))
ax.legend(loc='upper right', fontsize=8)
fig.tight_layout()
fig.savefig(output / 'plot.png', dpi=120, bbox_inches='tight')
chart = adapter.extract_chart(charts['plot.png'], output / 'plot.png')
chart.update(figureKey='plot.png', ops=[])
(output / 'chart.json').write_text(json.dumps(chart, indent=2) + '\n')
