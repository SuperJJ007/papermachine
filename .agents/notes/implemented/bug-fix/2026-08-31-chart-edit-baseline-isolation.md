# Agent Note: Saved-version baselines isolate chart previews and exports

Status: implemented

English | [中文](2026-08-31-chart-edit-baseline-isolation.zh.md)

## Problem

A capture-relative filename identifies a figure only within its producing run. Two model runs can save different layouts to that filename, while human edits carry only their exact parent version and cumulative operations. Resolving the earliest matching filename edits the wrong figure. Re-exporting without the original crop or dimensions changes the image independently of the requested operation. Applying previews to a shared mutable figure also lets discarded operations enter a later committed PNG without appearing in its operation log.

## Decision

The Runtime selects the nearest run-origin version of the requested artifact and verifies its figure key. This follows the session invariant that every human edit parents the current version of the same artifact. A newer unaddressable source cannot fall back to an older addressable figure merely because their names match.

Save interception retains a private snapshot of the figure and effective export settings. Python copies the figure and related save artists together, temporarily detaching its manager during copying so matplotlib cannot register a second pyplot figure. Saved rendering defaults accompany the snapshot. R serializes the plot with its resolved theme and the dimensions, device, background, and device arguments observed inside `ggsave`. These snapshots stay in memory, bounded by the existing retained-run limit; they are not a durable object format.

Every preview and save renders a fresh copy with the committed operations followed by the new operations. Warm and cold paths send the same cumulative list. Failure to reconstruct a committed operation rejects the request; partial failures among new operations keep their request-relative indexes. No preview mutates the baseline, and publication failure cannot advance it. Existing text artists retain their style when only their text changes. A figure-wide font operation sets every matched text artist's family and size directly on that private figure copy; the catalog's font entry samples the first axes' title (or, with no axes, the first text artist) from that same copy, so it already reports the applied value with no separate figure-level record — matplotlib never needed one, and ggplot2 already derives the same post-export value from its updated plot theme.

This specifies saved-version rendering within the broader [live-figure editing design](../../proposed/architecture/2026-08-28-science-live-figure-editing.md); element catalogs, model references, and viewer ownership remain independent decisions there. The [element-id collision decision](2026-08-28-chart-element-id-collision.md) remains applicable without supersession.

Cold source recovery uses a separate interpreter and operation-scoped cancellation; the [cold-replay decision](2026-08-31-science-cold-replay-isolation.md) owns analysis-state isolation and cleanup.

Figure serialization restores logical DPI while retaining the copied display transform. Before export, the copy normalizes that transform to its logical DPI; changing metadata alone cannot correct the raster dimensions. Main titles and subtitles have separate operation identities, including ggplot2's two null-axes targets, so pending-edit coalescing cannot discard either. All-axes operations visit every target even after an earlier target succeeds.

## Alternatives considered

**Choose the latest matching filename.** This can bypass a newer source that lacks addressable chart state. Version provenance must choose the source before checking addressability.

**Mutate and undo the live figure.** Inverse operations must restore all affected artists and renderer state on success, failure, and cancellation. Copying a saved baseline makes isolation independent of an expanding undo implementation.

**Replay source for every preview.** This repeats scientific computation and source side effects for each debounced edit. Private source recovery is reserved for expired registrations; retained snapshots support warm rendering.

## Consequences

Copying and reapplying committed operations adds work per preview, but makes the result independent of preview history and kernel warmth. Uncopyable custom figures retain their valid PNG and lose direct addressability rather than failing the scientific run. Tight cropping remains sensitive to changed text extents; preserving export settings is not a promise of identical dimensions for arbitrary edits. Cold replay still depends on reproducible source inputs and compatible plotting dependencies.

## Verification

Runtime regressions cover multiple producing runs, consecutive human edits, cumulative operations on warm and cold paths, and rejection of an unreconstructible committed operation. The opt-in `chart-fidelity.spec.ts` uses real Python/R kernels and the production sandbox to compare edited PNG bytes with direct source renders, then checks discarded previews, saved settings, text styling, post-save object mutation, and warm/cold/save equality. The runnable headless Science snapshot pins preview isolation and committed-operation context through the Loader composition.
