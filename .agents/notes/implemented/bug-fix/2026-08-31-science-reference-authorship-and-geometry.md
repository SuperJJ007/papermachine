# Agent Note: Science references retain user authorship and exported geometry

Status: implemented

English | [中文](2026-08-31-science-reference-authorship-and-geometry.zh.md)

## Problem

A Science edit is logged as `user/message` with `source.kind: science-edit`. Treating every non-`user` source as injected context hides the submitted instruction when Science suppresses process details and leaves its semantic trace without the request. Element references also become ambiguous when labels omit annotation text, colors represent categories, or export cropping invalidates the recorded positions. R PNG device exports can bypass `ggsave`, and retained mutable plot objects can make previews change later edits.

## Decision

A producer registers its user-input projection on the existing conversation event registry. Generic Chat and Detailed Trajectory use the projected instruction and references while retaining the logged source and Turn location. Unknown sources remain context; unloading a producer rebuilds loaded projections. Science owns its source-kind registration, including historical messages, without rewriting logs or adding Science branches to generic UI code.

Every PNG offers region selection. Element rows, composer references, and sent references share readable names; annotation text, Greek symbols, and duplicate suffixes distinguish targets while stable wire ids remain intact. Recorded colors identify chart content, and hovering or focusing highlights available exported bounds. Missing bounds explicitly retain region selection. Unsaved previews block new references because a preview has no durable version to cite.

Matplotlib captures element bounds during the final export draw, including tight cropping, and resolves duplicate ids to their own artist occurrence. R captures a single complete ggplot printed to a PNG device, retaining its dimensions, DPI, device, and font options. Built-plot axis labels enter the catalog, and hit-map ids must belong to that catalog. Composite R graphics and base plots remain raster-only. The [baseline-isolation decision](2026-08-31-chart-edit-baseline-isolation.md) owns saved snapshots, render defaults, and cumulative edit replay; export geometry and PNG-device capture use those same snapshots.

## Alternatives considered

**Classify every `user/message` as human input.** Rejected because plugins also log model context through that event. Producer registration preserves the distinction without coupling the generic UI to Science.

**Rename targets from their color or merge annotations with series.** Rejected because equal colors do not prove common ownership. Names describe separate catalog elements; ids and version validation remain authoritative.

**Estimate cropped coordinates from the uncropped figure.** Rejected because layout and cropping can change the exported transform. Positions must describe the exact saved PNG.

## Consequences

Old logged reference messages become visible when the Science plugin loads. Old PNG metadata is unchanged: versions without a hit map use region selection, and another export is needed for newly supported structured positions. Series bounds can enclose a complete curve; they do not assert that every overlapping fill or legend item is the same element.

Registry, conversation, and viewer tests cover projection reload, disposal, readable references, preview fencing, and pixel normalization. The real Python/R kernel scenario covers export snapshots, duplicate annotation positions, device capture, and preview isolation. The assembled Web scenario records reference-bearing second-turn input before and after reload. The [element-id decision](2026-08-28-chart-element-id-collision.md) continues to own uniqueness; this decision owns exported positions and reference presentation.
