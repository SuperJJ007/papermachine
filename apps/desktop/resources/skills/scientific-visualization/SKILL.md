---
name: scientific-visualization
description: "Create and audit truthful, accessible, publication-ready scientific figures with Matplotlib, Seaborn, or Plotly — layouts, uncertainty/missing-data displays, color/contrast review, image metadata validation, and journal export planning. Trigger terms: 画图、出图、作图、论文配图、可视化、科学图表."
license: MIT
compatibility: Requires Python 3.11+; pinned example versions in `references/sources.md`. Scripts are network-free. Plotly static export with Kaleido v1 requires a compatible Chrome/Chromium installation.
metadata:
  version: "1.1"
  skill-author: K-Dense Inc.
---

# Scientific Visualization

Build figures that preserve scientific meaning before optimizing appearance: separate universal principles from dated publisher rules, preserve raw data and transformations, use color redundantly, and inspect delivered files rather than trusting plotting defaults.

## Non-negotiable guardrails

- Never alter, hide, invent, or selectively enhance data to improve a figure.
- Preserve raw tables/images, exclusions, missing-value codes, analysis code, normalization, binning, image adjustments, and random seeds.
- Do not infer journal requirements. Identify the exact journal, article type, figure type, and submission phase; verify its live official guidance.
- Do not claim that a palette, DPI value, format, or automated report makes a figure accessible or journal-compliant.
- Do not silently connect missing observations, suppress inconvenient points, upsample images as if detail increased, or tune axes/dual axes to exaggerate a conclusion.
- Keep interactive and static outputs distinct deliverables; interactive hover does not substitute for labels, alt text, keyboard access, or a static fallback.

Read `references/publication_guidelines.md` for deceptive-encoding/integrity checks and `references/journal_requirements.md` once the target and phase are known.

## Workflow

Run every step below through `run_python` (or `run_r`), not a shell session.

### 1. Define the evidence and destination

Record audience/medium, exact publisher/journal/article type/phase and final width, variable semantics/units/sample structure/missing values, the estimator and uncertainty definition, every transformation (filtering, aggregation, normalization, smoothing, bins, image processing), and source-data paths. If requirements are unknown, build a provisional figure and label publisher choices pending verification.

### 2. Choose an honest encoding

Prefer position on a common scale. Bars/areas include a zero baseline; nonzero-limit point/line plots show context and disclose breaks. Name the uncertainty interval (SD/SE/CI/percentile/posterior) with `n` and replication unit. Show raw observations when feasible. Distinguish missing/zero/censored/excluded values instead of silently connecting or dropping them. Scale area/volume, never radius/diameter. Declare the log-axis base and zero/negative policy. Record bin edges/bandwidth and normalization formula. Justify any dual axis instead of engineering apparent correlation. Full checklist: `references/publication_guidelines.md`.

### 3. Design accessibility in, not after

Pair color with marker, line style, hatching, direct label, or panel separation. Choose qualitative/sequential/diverging/cyclic color by data semantics; give missing/out-of-range values an explicit color. Audit rendered-size contrast against WCAG 2.2 (4.5:1 normal text, 3:1 large text/graphical objects). Provide alt text, a longer description for complex figures, and underlying data for web delivery. A grayscale screen is useful but not a complete accessibility test. Palette values and exact contrast math: `references/color_palettes.md`.

### 4. Implement with scoped styles

Use Matplotlib's object-oriented API and `style_context(name, palette_name=...)` from `scripts/style_presets.py` instead of mutating global rcParams. Prefer `layout="constrained"` on `plt.subplots(...)` (colorbars, nested GridSpec, subfigures, `subplot_mosaic`) and never call `tight_layout()` afterward — it disables constrained layout. Skip `bbox_inches="tight"` unless changing the page size is intentional. Colormap normalization, current Seaborn `errorbar` usage, and Plotly/Kaleido static export: `references/matplotlib_examples.md`.

### 5. Export explicitly and record provenance

Call `figure_export.export_figure(fig, path, formats=[...], dpi=..., bbox_inches=None, provenance={raw_data, transformations, uncertainty, missing_data}, write_manifest=True)`. It refuses implicit overwrite, writes atomically, keeps vector DPI for embedded rasters, uses TIFF LZW, and can embed PDF/PS Type 42 fonts for editable text (SVG `fonttype="none"` keeps text editable without embedding; `"path"` embeds glyph shapes but loses editable text). It does not validate scientific content or publisher acceptance. Use an opaque explicit background unless transparency is required. Font/transparency checks: `references/matplotlib_examples.md`.

### 6. Inspect, compare, and review

Inspect file metadata (`image_metadata.py`), audit palette contrast/grayscale (`palette_audit.py`), and compare against a dated publisher snapshot (`export_plan.py`). View at final size in context, manually review fonts, embedded rasters, clipping, legends, scale bars, image integrity, caption, alt text, and source data, then re-check the live target-journal page immediately before upload.

## Bundled scripts

Every script under `scripts/` is deterministic, network-free, bounded, rejects symlink inputs/destinations, and refuses overwrite unless `--force` is explicit. Run each through `run_python` via `subprocess.run([sys.executable, "scripts/<name>.py", ...])` or by importing its functions; each script's own `--help` lists its arguments.

- `image_metadata.py <file> [--min-dpi N] [--target-width-mm N] [--alpha-policy forbid|allow]` — raster/SVG/PDF/EPS metadata (dimensions, effective DPI, mode, alpha, ICC, compression, page size, PDF fonts); does not inspect every embedded raster in a vector container.
- `palette_audit.py --palette <name> --background <hex> --role graphical|text` — WCAG sRGB contrast plus CIE L* grayscale screening (a heuristic, not a standard).
- `export_plan.py --publisher <name> --figure-type <type> --width single|double --phase initial|revised|final [--input figure.pdf]` — plans/screens against dated official snapshots, not automatic compliance rules.
- `style_preview.py --style <name> --palette <name> --formats png,svg` — renders a style/palette preview.
- `style_presets.py --list`/`--show <name>` inspects bundled styles; `figure_export.py --demo <path> --manifest` smoke-tests the exporter.

## Assets and references

Assets: `publication.mplstyle` (general print), `nature.mplstyle` (dated Nature starting point, not a compliance preset), `presentation.mplstyle` (projected-display), `color_palettes.py` (Okabe-Ito/Paul Tol values), `publisher_profiles.json` (dated planning snapshots). Style files omit `#` in hex colors because `#` begins comments in `.mplstyle` parsing.

References: `publication_guidelines.md` (integrity, deceptive encodings, accessibility), `color_palettes.md` (palette values, WCAG contrast, color management), `journal_requirements.md` (phase-specific publisher snapshots), `matplotlib_examples.md` (runnable Matplotlib/Seaborn/Plotly patterns), `sources.md` (URLs, dates, versions).

## Final review checklist

- [ ] Raw data/images, transformation code, missing/exclusion/bin/normalization/uncertainty facts are preserved and explicit.
- [ ] Baselines, scales, limits, area/volume encodings, and color redundancy/contrast are honest and reviewed.
- [ ] Accessible description/data alternative provided where applicable.
- [ ] Dimensions, DPI, format, fonts, transparency, and file size inspected after export.
- [ ] Publisher rules verified for the exact journal and phase; no automated report is presented as a compliance certification.
