# @deepseek-ai/dsh-client-ui-science

English | [中文](README.zh.md)

Browser presentation for the durable `save_chart` and `publish_outcome` transcript rows, plus the Science settings card. The transcript rows register keyed `tool.call.toolview` entries and consume only frozen Tool call/result data, the client-safe `science` Session projection, and the conversation-owned session attachment loader; they neither create Science facts nor load attachment bytes through a separate route. The settings card registers a keyed `settings.plugin.item` entry and reads/writes the fixed `science` profile's Conda prefixes through the bound settings scope.

## Chart row

A settled `save_chart` result with supported tagged presentation metadata renders the logical chart name, version, title, optional caption, source run, dimensions, and byte count. The row passes the durable `ImageAttachmentRef` to the shared `MessageImage` atom for loading, retry, preview, keyboard activation, lightbox display, and focus restoration. Running, failed, interrupted, missing, malformed, or unsupported presentation values retain a readable text fallback.

## Outcome row

A settled `publish_outcome` result renders its own immutable revision, title, Markdown summary, and run/chart/message evidence labels. Exact chart citations resolve against the current client-safe `science` projection and reuse the same attachment loader for thumbnails. A missing projection, chart version, or attachment leaves the publication text and evidence identity visible and reports the unavailable visual.

## Settings card

The card registers into `settings.plugin.item` under the fixed `science-runtime` namespace — the namespace `@deepseek-ai/dsh-science-runtime/with-settings` registers, not a package or product id — so it appears whenever the Host serves that namespace and stays absent otherwise, with no navigation row or Host change of its own. It binds the namespace through `ctx.settingsScope` and edits only `['science', 'pythonPrefix']` and `['science', 'rPrefix']` (the section root is the profile map itself, addressed by the fixed `science` profile id, not a `profiles` wrapper field), plus `unsetPath(['science'])` for the explicit remove-override action; no code path writes the section root. Both fields are `role('secret')`, so their stored value never rides a settings response — the card learns per-field presence from `SettingsScopeSnapshot.secrets` and never echoes a stored path back into an input. A blank replacement input is a no-op, and every successful change is labeled restart-required, matching the Runtime's restart-only resolution. The card owns its own staging and revision fencing rather than reusing the Plugins section's card chrome or staged-form model, which the bundle-purity gate forbids importing as values.

## Composition

Load this browser plugin after `@deepseek-ai/dsh-client-ui-tool`, `@deepseek-ai/dsh-client-ui-attachment`, the client locale/runtime packages, `@deepseek-ai/dsh-client-ui-settings` (`ctx.settingsScope`), and a Host composition that exposes the `science` Session projection. The shipped Web bundle mounts `@deepseek-ai/dsh-science-runtime/with-settings` with an intentionally empty profile map, so the card appears with an unconfigured `science` profile until a person names Python/R Conda prefixes and restarts the Host; CLI and headless bundles keep their own explicit Runtime composition and show no card.

## Model Experience

None, as the transcript rows render already-logged Tool results and the settings card edits deployment configuration; neither changes a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **PNG presentation only** — Science version one saves PNG charts, so this package has no generic chart-specification or non-image renderer.
- **No independent attachment cache** — attachment lifetime, authorization, retry, and object-URL revocation remain owned by the conversation loader and attachment UI.
- **One fixed profile, two fields** — the card edits only the shipped `science` profile's `pythonPrefix`/`rPrefix`, because the built-in preset is the only current product consumer; another deployment profile id remains a file/configuration concern, not a browser-managed one.
- **No discovery, probing, or live apply** — the card never lists, probes, or validates a Conda environment and carries no filesystem picker or live-apply control; a stored prefix is opaque until a Host restart binds it.
