# Agent Note: Native live-figure editing

Status: implemented

English | [中文](2026-08-28-science-live-figure-editing.zh.md)

## Problem

Researchers need to select and adjust an existing chart without asking the model to recreate it in another plotting grammar or mutate the analysis kernel during preview.

## Decision

Live-figure editing retains native matplotlib or ggplot state and the exact PNG displayed to the user. The project store owns figure state, element catalog, hitmap, export settings, source lineage, and cumulative edit operations. Native panes perform five bounded typed operations: title, axis label, legend position, grid visibility, and font changes. Unsupported elements remain referenceable without claiming they are directly editable.

Warm replay edits a private saved baseline; cold replay uses an isolated interpreter and exact recorded source inputs. Preview does not create an artifact or Science run event. Explicit save commits a new immutable version. A mismatched hitmap disables geometry selection while retaining the catalog. Both adapters must implement and validate an operation before it expands the shared direct-edit API.

## Alternatives considered

**Translate plots to Vega, Plotly, or another grammar.** This creates a second source of plotting semantics and loses native-library behavior.

**Edit the live analysis object in place.** Preview would mutate later analysis, and repeated edits would depend on interaction order rather than an immutable baseline.

**Advertise arbitrary text instructions as direct operations.** Unsupported operations could silently degrade into model work or adapter-specific behavior.

**Apply global rcParams changes or enumerate every installed font.** Edits would escape their figure and acquire host-dependent font-discovery behavior.

## Consequences

Native DPI and recorded export settings matter for exact geometry. Base R graphics can still produce PNGs without gaining a ggplot editing catalog. Catalog families include titles, labels, ticks, legends, series, grids, axes, figure size, fonts, and annotations; catalog membership does not imply support by the five direct operations. Multi-axes titles, R legend mappings, and coordinate conversion require adapter-specific handling. Historical replay measurements are not latency guarantees. Native V3 admission and slim tool receipts remain owned separately.

## Related

Related owners: [chart-edit-baseline-isolation](../bug-fix/2026-08-31-chart-edit-baseline-isolation.md); [science-cold-replay-isolation](../bug-fix/2026-08-31-science-cold-replay-isolation.md); [chart-font-alias-and-title-row](../bug-fix/2026-09-03-chart-font-alias-and-title-row.md); [science-required-session-events](2026-09-10-science-required-session-events.md); [science-native-sidebar](2026-09-10-science-native-sidebar.md).
