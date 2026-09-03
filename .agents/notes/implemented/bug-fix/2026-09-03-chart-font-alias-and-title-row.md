# Agent Note: Chart-edit font alias resolution, commit failure detail, and the titleless-figure Title row

Status: implemented

English | [中文](2026-09-03-chart-font-alias-and-title-row.zh.md)

## Problem

`set_font` with a generic family (matplotlib's rcParams aliases `sans-serif`/`serif`/`monospace`, R's grid-device generics `sans`/`serif`/`mono`) always failed with `font_not_found`. `matplotlib.font_manager.FontProperties(family=<bare str>)` takes the fontconfig-pattern parse path whenever `family` is the constructor's only argument, and that grammar rejects the hyphen in `"sans-serif"`; the chart-edit panel's font control re-sends the current family on a size-only change (and defaults to `"sans-serif"` when no font element exists yet), so plain size edits failed too. R's `.dsh_font_available` required `systemfonts::match_fonts()`'s resolved family name to equal the requested string literally, which macOS's CoreText-backed `systemfonts` fails even for generic aliases — it silently substitutes a system default instead of erroring, so the resolved name never matches the alias.

A commit (`applyChartEdit`) that resolved none of its requested operations threw one generic "No chart edit operation resolved an addressable element" message, discarding each op's own resolution reason (`font_not_found` for `set_font`, `element_not_found` for others) that a preview of the same ops would have reported per op.

The chart-edit panel rendered no control at all for Title when the runtime had not extracted one — both adapters only extract a `title` catalog element once text exists — even though `set_title` with `axes: null` creates one unconditionally. A titleless figure had no way to add a title from the panel.

## Decision

### Generic font family aliases resolve instead of failing

`chart_matplotlib.py`'s `set_font` now calls `FontProperties(family=[family])`. A one-element list keeps the constructor off the fontconfig-pattern path — that path triggers only for a bare `str` family with no other keyword argument — so a generic alias with punctuation the pattern grammar rejects still resolves through `rcParams['font.<alias>']`. The `except` narrows from `Exception` to `ValueError`: once the pattern path is unreachable, `findfont(..., fallback_to_default=False)` raising `ValueError` for an unresolved family is the only exception this call site can still raise, so a genuine bug elsewhere at the call site propagates instead of being relabelled `font_not_found`.

`chart_ggplot2.R`'s `.dsh_font_available` now treats `"sans"`, `"serif"`, `"mono"` (R's grid-device generic families) and `"sans-serif"`, `"monospace"` (the CSS-style spelling the shared panel's font control stages, regardless of which language produced the chart) as always available, skipping `systemfonts::match_fonts()`'s identity check for them entirely. R's grid/cairo devices accept all five as built-in generics and never error rendering them, but `systemfonts` on macOS substitutes an unmatched or generic family to a system default without erroring, so its resolved name never equals the request literally — which previously rejected every one of them.

### A whole-request commit failure names every op's own reason

`ScienceRuntime`'s commit path (`performChartEdit` in `packages/science/science-runtime/src/index.ts`) builds its `CHART_ELEMENT_NOT_FOUND` message from each failed op's 1-based index, op name, and resolution reason — `No chart edit operation applied: op 1 set_font — font_not_found` — instead of one generic sentence. `edit-message.ts`'s `translateChartRuntimeError` already forwards `error.message` unchanged, so no mapping change was needed there. The chart-edit panel's `style.failed` render (the whole-request-rejection path) and its `panel.failedOp` render (the partial-failure path) now share one `localizeFailureReason`/`localizeFailureMessage` helper pair that substitutes the existing `panel.fontNotFound` localized string for the one stable machine-readable reason (`font_not_found`), so a `set_font`-only rejection reads the same whether every op failed (commit) or only some did (preview).

### The chart-edit panel always offers a Title control

`ScienceChartEditPanel.tsx`'s `directEditRows` now synthesizes a titleless `title` row (`id: 'title', axes: null, current: ''`) whenever the catalog carries no `title`-kind element, staging the same `set_title`/`axes: null` op a real title row would. It sorts first regardless of the general sort — `title` leads `DIRECT_EDIT_ROW_ORDER` and `axes: null` already sorts before every axes-scoped row — so its position matches where a real title row would land. Because it names no catalog element, its row's reference `+`/`−` button is suppressed entirely (`referenceable: false`) rather than left enabled against a target the store cannot match.

`x_label`/`y_label` did not get the same treatment. `set_axis_label`'s `axes: null` broadcasts the same text to every panel (`_selected_axes` in `chart_matplotlib.py` returns every axes for a `null` index), unlike `set_title`'s `axes: null`, which takes an entirely different branch that creates one figure-wide suptitle. Synthesizing a titleless label row correctly would require picking a specific axes index per row, or one row per axes — real additional design, not a mirror of the title fix — so it stays out of this change.

## Alternatives considered

**Keep matplotlib's `family=family` (bare string) call and special-case the hyphenated names.** Rejected: the constructor's fontconfig-pattern path is triggered by argument shape (a bare `str`, no other kwarg), not the value, so any future alias with pattern-special characters would reproduce the same failure. Passing a one-element list sidesteps the pattern grammar entirely instead of enumerating names against it.

**Keep the R `.dsh_font_available` strict identity check and special-case only `"sans"`/`"serif"`/`"mono"`, matching the pre-existing `systemfonts`-unavailable fallback.** Rejected: the shared panel's font control stages the CSS-style `"sans-serif"`/`"monospace"` spelling as its own default regardless of which language produced the chart (`fontInitial`'s `'sans-serif'` fallback), so a chart-agnostic fix needs both spellings or the same defect resurfaces for any R chart with no font element yet.

**Thread structured `failedOps` through the thrown commit error instead of formatting them into the message text.** Rejected for this change's scope: it would widen `ScienceRuntimeError`, the `ScienceEditError` RPC boundary, and the client's `RpcError` shape to carry structured detail. The chosen message format (`op <n> <op name> — <reason>`) is deliberately unambiguous so the panel's single-token substitution stays reliable without full structural propagation.

**Split `CHART_ELEMENT_NOT_FOUND` into a code per failure reason.** Rejected: one commit can combine element-resolution and font-resolution failures across its ops, and `translateChartRuntimeError` already maps both existing codes identically to `CHART_OP_INVALID`, so a new split code would carry no distinguishable behavior for any current consumer.

**Synthesize `x_label`/`y_label` rows the same way as `title`.** Rejected here: unlike `set_title`, `set_axis_label`'s `axes: null` means "every axes" — a real behavioral broadcast — so a titleless-label synthesis needs per-axes target selection this change does not design.

## Consequences

`set_font` with a generic alias — the panel's own default and its `FONT_FAMILIES` list — now succeeds for both languages; a size-only edit that re-sends the current family no longer fails. A whole-request commit rejection names which op failed and why, matching the detail a preview of the same ops already reports; the runtime README documents the enriched message. The chart-edit panel can add a title to any figure, titled or not, from one row; `x_label`/`y_label` remain unavailable to add where the runtime extracted none, so a titleless figure with default axis labels still needs a code-side edit for those two element kinds.
