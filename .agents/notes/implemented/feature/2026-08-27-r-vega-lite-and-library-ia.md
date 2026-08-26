# Agent Note: R Vega-Lite and library information architecture

Status: implemented

English | [中文](2026-08-27-r-vega-lite-and-library-ia.zh.md)

## Problem

Science chart behavior depended on incidental generation and presentation paths. R guidance treated every chart as raster output even though the editable viewer consumes a language-independent Vega-Lite media type. The viewer truncated Vega-Lite source at the ordinary text display limit before parsing, so valid specifications with large inline datasets became invalid JSON and appeared as source text. The Details column also placed document tabs above an additional library switch, producing three navigation levels and an empty tab row when no document was open.

## Decision

### R-authored editable charts

R code should construct an expressible Vega-Lite specification as nested lists and data frames, then write `.vl.json` with `jsonlite::write_json(spec, path, auto_unbox = TRUE, digits = NA)`. Runtime capture already assigns `application/vnd.vega-lite+json` by extension without inspecting the execution language, so R and Python artifacts use the same structural selection and direct style-edit path. Raster PNG remains the fallback for charts that Vega-Lite cannot express.

No ggplot2-to-Vega-Lite converter is introduced. Direct JSON authoring uses the existing runtime dependency and avoids a translation layer whose supported geometry and transformation subset would become an additional product obligation.

### Vega-Lite render and display limits

The viewer parses a complete Vega-Lite specification through `MAX_VEGA_LITE_SPEC_CHARACTERS` (8,000,000 characters). This is a browser parse-and-render safety limit. It is independent of `MAX_ARTIFACT_TEXT_CHARACTERS` (100,000 characters), which bounds source displayed after an oversized specification, parse failure, or renderer failure. Ordinary JSON continues to apply the 100,000-character display cap before parsing.

Chart-generation guidance also directs Python authors to aggregate or sample data and retain only the rows and columns used by the chart before passing a table to Altair. The larger viewer limit supports legitimate specifications; it does not make embedding an unneeded raw table desirable.

### Two-level file library

The Details header owns the first level: Artifacts and Project files. The selection store persists that choice as `libraryPage`. Both pages share one second-level strip of open artifact and workspace-file documents. Selecting a first-level page while a document is active returns to the chosen library page without closing any document. The library body has no additional section switch, and the document strip is absent when its ledger is empty.

## Alternatives considered

**Keep R charts raster-only.** Rejected because the runtime and viewer already use a language-independent media type, and R can emit the required JSON without a chart-conversion dependency.

**Raise the ordinary text cap.** Rejected because rendering requires complete JSON while fallback source needs a bounded DOM. One shared limit would either keep corrupting valid specifications or allow excessive raw-text rendering.

**Give artifacts and project files separate document strips.** Rejected because an open document's source does not change its navigation behavior. A shared strip preserves deduplication, version replacement, and close-neighbor rules.

## Consequences

R-generated Vega-Lite charts receive the same element selection and style editing as Python-generated specifications, while raster region selection remains available. Specifications between 100,000 and 8,000,000 characters render from complete JSON; failure states state their reason and show bounded source. The Details column has two visible navigation levels, remembers its library page across document viewing and panel reopen, and allocates no tab-strip height until a document is open.
