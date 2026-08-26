# Agent Note: Vega-Lite selection outline

Status: implemented

English | [中文](2026-08-26-vega-selection-outline.zh.md)

## Problem

Raster region selection drew a rectangle over the artifact, while selecting a Vega-Lite spec path changed only the corresponding text row's pressed state. The chart therefore gave no visual confirmation of which rendered element the style panel addressed.

## Decision

The Vega-Lite stage owns one non-interactive outline over its rendered SVG. After `vega-embed` settles, it uses Vega's SVG role classes: one top-level `.role-title`, `.role-mark`, X/Y `.role-axis` identified by its accessible label, or sole `.role-legend` yields an exact subtree rectangle. A selected composition-nested path, an unsupported channel, multiple candidate role groups, or any other ambiguous mapping outlines the complete SVG. The overlay uses the same border and translucent fill as raster `regionBox`.

The rectangle is derived from `getBoundingClientRect()` relative to the scrollable chart frame. It recomputes when selection changes, a new SVG render settles after document edits, or a shared `ResizeObserver` reports frame or chart-content resizing. Render failure removes it with the hidden chart.

## Alternatives considered

**Infer every nested Vega-Lite path from generated mark names** — rejected because names such as layer and concat groups are compiler output, not a stable path-mapping API, and transforms may produce multiple scenegraph marks for one source path.

**Use only a chart-wide outline** — rejected because Vega's role classes provide stable, accessible exact targets for common top-level title, mark, axis, and single-legend selections.

**Mutate SVG nodes with a selected class** — rejected because `vega-embed` owns and replaces those nodes. A React-owned sibling overlay has explicit lifecycle and does not modify renderer output.

## Consequences

Exact outlines cover top-level `title`, one `mark` group, `encoding.x`, `encoding.y`, and a legend-producing top-level color/fill/stroke/size/shape/opacity channel only when exactly one legend exists. Nested composition paths and ambiguous roles intentionally use the whole-chart fallback. This note extends, but does not supersede, [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.md), which still owns selection and composer semantics.
