# @deepseek-ai/dsh-client-ui-science

English | [中文](README.zh.md)

Browser presentation for the durable `save_chart` and `publish_outcome` transcript rows. The plugin registers keyed `tool.call.toolview` entries and consumes only frozen Tool call/result data, the client-safe `science` Session projection, and the conversation-owned session attachment loader. It neither creates Science facts nor loads attachment bytes through a separate route.

## Chart row

A settled `save_chart` result with supported tagged presentation metadata renders the logical chart name, version, title, optional caption, source run, dimensions, and byte count. The row passes the durable `ImageAttachmentRef` to the shared `MessageImage` atom for loading, retry, preview, keyboard activation, lightbox display, and focus restoration. Running, failed, interrupted, missing, malformed, or unsupported presentation values retain a readable text fallback.

## Outcome row

A settled `publish_outcome` result renders its own immutable revision, title, Markdown summary, and run/chart/message evidence labels. Exact chart citations resolve against the current client-safe `science` projection and reuse the same attachment loader for thumbnails. A missing projection, chart version, or attachment leaves the publication text and evidence identity visible and reports the unavailable visual.

## Composition

Load this browser plugin after `@deepseek-ai/dsh-client-ui-tool`, `@deepseek-ai/dsh-client-ui-attachment`, the client locale/runtime packages, and a Host composition that exposes the `science` Session projection. The Web bundle mounts it for replay even though the base Web Host does not mount `@deepseek-ai/dsh-science-runtime`; live chart creation still requires an explicit Runtime deployment row.

## Model Experience

None, as this package renders already-logged Tool results in the browser and never changes a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **Transcript rows only** — current-state Science Details and settings belong to a later product slice.
- **PNG presentation only** — Science version one saves PNG charts, so this package has no generic chart-specification or non-image renderer.
- **No independent attachment cache** — attachment lifetime, authorization, retry, and object-URL revocation remain owned by the conversation loader and attachment UI.
