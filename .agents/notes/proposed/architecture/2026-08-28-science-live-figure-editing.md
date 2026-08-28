# Agent Note: Live figure objects and operation logs for Science chart editing

Status: proposed

English | [中文](2026-08-28-science-live-figure-editing.zh.md)

## Problem

Science needs chart editing that preserves the plotting libraries researchers already use, lets a person select meaningful chart elements from the displayed PNG, and remains reproducible after the original kernel dies. The removed spec-first design made Vega-Lite a second chart grammar, required Python and R to author that grammar differently, and could not represent every matplotlib or ggplot2 chart. It also made the browser rendering different bytes from the captured scientific artifact.

Raster-region selection remains useful when a chart or image has no addressable structure, but a rectangle alone cannot identify a title, axis label, series, legend, or annotation. Direct edits must therefore use plotting-library structure without treating the kernel's mutable object as durable state.

## Proposal

The chart foundation is a live figure object plus a durable operation log. Models continue to author matplotlib or ggplot2 code and save an `image/png` under `SCIENCE_ARTIFACT_DIR`. At run completion, the kernel adapter associates each intercepted `savefig` or `ggsave` path with its live figure, extracts a closed element catalog and pixel hit map, and stores that projection on the artifact version. The displayed image is the captured PNG itself.

Three ownership decisions constrain this foundation. Each save keeps the DPI selected by matplotlib or ggplot2; the Runtime does not normalize different libraries to one export density. Intercepted `Figure.savefig()`/`pyplot.savefig()` and `ggsave()` calls are the only registration entry points, so device-level R output and base graphics remain ordinary PNGs. The `chart` projection belongs to `science/artifact-saved` and the Session projection rather than the project artifact store, which continues to persist exact image bytes and ordinary version metadata.

A direct edit first asks the current language kernel to apply the validated operations to the registered live figure. A missing registration triggers private recovery: the Runtime re-executes the exact source run with its materialized inputs, reapplies the version's prior operation log, and then applies the new operations without recording an additional scientific run. It exports at the saved DPI, re-extracts the catalog and hit map, and appends an `origin: 'human-edit'` artifact version whose operation log contains only successful operations in replay order. Partial target failures are returned with their request indexes; a request with no successful operation rejects. The figure object, recovery run, and private runtime handle never enter the session log or model namespace.

The durable artifact record gains an optional `chart` field:

```ts ignore-check
interface ScienceChartState {
  runtime: 'matplotlib' | 'ggplot2'
  figureKey: string
  png: { width: number; height: number; dpi: number }
  elements: readonly ScienceChartElement[]
  hitmap: readonly ScienceChartHit[]
  hitmapStatus: 'ok' | 'unavailable'
  ops: readonly ScienceChartOp[]
}
```

The field is carried by `science/artifact-saved` and projected to the viewer. `SESSION_FORMAT_VERSION` remains `0` under the pre-release policy. A PNG produced through an unsupported route, including base R `plot()` and an R graphics device that bypasses `ggsave()`, has no `chart` field and keeps ordinary raster behavior. A raster-size mismatch preserves extracted elements but sets `hitmapStatus: 'unavailable'` and requires an empty `hitmap`; consumers never apply hit coordinates whose pixel grid does not match the saved PNG.

A direct edit does not enqueue a model turn. When a later model run sees the same artifact, `get_science_state` and artifact receipts expose the cumulative edit count plus each operation name and element target alongside the exact version, while omitting text, colors, sizes, coordinates, and other operand values. Structural changes such as changing chart type, facets, or source data remain model-authored code changes. After code changes, stored operations are revalidated by element identity; operations whose targets no longer resolve are reported rather than guessed.

### Closed element catalog

Version one recognizes exactly these 13 element families: `title`, `subtitle`, `x_label`, `y_label`, `tick_labels`, `legend`, `series[<label>]`, `grid`, `axis_range`, `axis_scale`, `figure_size`, `font`, and `annotation`. Subplots and facets use an `axes[i]` prefix. Unlabelled fitted lines, per-mark hits, individual legend swatches, and ggplot2 facet-local colors are not addressable in version one.

### Closed operation set

Version one accepts exactly six operations: `set_title`, `set_axis_label`, `set_series_color`, `set_legend_position`, `set_tick_font_size`, and `add_reference_line`. Operations carry typed operands and an element identity where applicable. Axis range, axis scale, grid toggling, whole-figure fonts, and figure size are candidates for a later version because their matplotlib and ggplot2 behavior is not yet symmetric.

### Runtime ownership

The runtime owns a private mapping from `(runId, capture-relative path)` to a figure handle. The kernel wire adds explicit extract and apply operations rather than exposing arbitrary object access. The artifact store owns durable PNG bytes; the Science session owns the catalog, hit map, and operation records; the viewer only renders the projection and submits typed operations. Existing `artifact_inputs`, `edit_of`, version ancestry, raster-region messages, declared raster capture, artifact library, and provenance remain in place.

## Experimental evidence

The adapter experiments found 12 of 13 catalog element families for matplotlib and 11 of 13 for ggplot2. Pixel hit testing selected the intended element in 88.6% of matplotlib trials and 89.5% of ggplot2 trials. All six version-one operations changed their intended output. Rebuilding a figure and replaying its operation log produced a pixel difference of zero in the deterministic fixtures.

Warm operation round trips measured about 12 ms for matplotlib and 65–96 ms for ggplot2. Cold restoration measured about 370 ms for matplotlib and 570 ms for ggplot2. These results support immediate previews while a live object exists and bounded replay when it does not; they are not product latency guarantees.

## Alternatives considered

- **Vega-Lite spec-first charts.** Rejected and removed. It introduced a second plotting grammar, imposed asymmetric authoring on Python and R, excluded charts the grammar cannot express, added a large browser renderer, and displayed an SVG rather than the captured PNG. Its structural selection and style editor do not justify that parallel pipeline when the native plotting objects already expose the required semantics.
- **A Flint-based `plot` tool.** Rejected after three experiments. A dedicated tool would replace ordinary matplotlib and ggplot2 authoring without eliminating the need to intercept saved figures, extract native elements, or replay source code. The live-object design obtains the required control from the libraries users already know.
- **Plotly.** Rejected. It would add another plotting grammar and runtime, would not cover existing matplotlib and ggplot2 code, and would still require a separate path for unsupported scientific geometry.
- **Persist live figure objects.** Rejected because Python and R objects are process-local, mutable, and not a stable session format. Source, inputs, deterministic adapters, and typed operation logs are the durable recovery inputs.
- **Keep only raster rectangles.** Rejected as the primary chart editor because rectangles do not carry semantic identity and cannot reliably survive a code rerun. Region selection remains the fallback for unaddressable PNGs.

## Acceptance criteria

- Captured matplotlib and ggplot2 PNGs produced through supported save paths carry a bounded element catalog, hit map, and empty operation log; unsupported PNGs remain valid without chart metadata.
- All 13 element families and six version-one operations have shared codecs, strict validation, and adapter coverage for each supported runtime or an explicit unsupported result.
- Applying operations creates a new PNG artifact version with exact parentage and cumulative operations; no direct edit mutates an existing version.
- A dead kernel is restored by replaying the exact source run, materialized inputs, and operation log, and deterministic fixtures reproduce the edited PNG with zero pixel difference.
- The viewer selects elements from the PNG hit map, shows controls allowed for that element, previews through the runtime, and saves a new version only through explicit user action.
- Model-authored structural edits receive the exact current version and operation context; invalidated operations are reported after revalidation.
- Keyless snapshots cover extraction, apply, replay, receipts, and model-visible operation context; browser coverage pins selection and save behavior.

## Risks

- Monkey-patching save paths may miss figures saved through unsupported APIs or after the figure is closed. Those artifacts must degrade to ordinary PNGs without claiming addressability.
- Plotting-library releases may change private object details. Adapters must use maintained public APIs where possible and fail loud when a catalog or operation cannot be produced.
- Element identity across a source-code change is heuristic when labels are duplicated or removed. Revalidation must reject ambiguity rather than applying an operation to a plausible but different element.
- Hit maps can be several kilobytes per version and need explicit bounds. Overly coarse maps reduce selection accuracy; overly detailed maps increase session and projection cost.
- Replay executes model-authored source again. It must reuse the existing confined runtime, exact materialized inputs, timeout policy, and durable run accounting rather than become an unlogged shortcut.
- Matplotlib and ggplot2 do not support every operation symmetrically. The closed operation set must not grow until both adapters define the behavior or expose an explicit runtime-specific rejection.
