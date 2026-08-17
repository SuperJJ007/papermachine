# @deepseek-ai/dsh-client-ui-science

English | [中文](README.zh.md)

Browser presentation for the durable `save_chart` and `publish_outcome` transcript rows, the Science settings card, and the session-header action plus Details entry that expose current-state Science outside the transcript. The transcript rows register keyed `tool.call.toolview` entries and consume only frozen Tool call/result data, the client-safe `science` Session projection, and the conversation-owned session attachment loader; they neither create Science facts nor load attachment bytes through a separate route. The settings card registers a keyed `settings.plugin.item` entry and reads/writes the fixed `science` profile's Conda prefixes through the bound settings scope. The header action and Details entry register into `@deepseek-ai/dsh-client-ui-conversation`'s `conversation.session.header.actions` and `conversation.details.view` seats; both are pure readers of the same client-safe projection, and neither builds a second projection reader, chart store, Outcome editor, or attachment cache.

## Chart row

A settled `save_chart` result with supported tagged presentation metadata renders the logical chart name, version, title, optional caption, source run, dimensions, and byte count. The row passes the durable `ImageAttachmentRef` to the shared `MessageImage` atom for loading, retry, preview, keyboard activation, lightbox display, and focus restoration. Running, failed, interrupted, missing, malformed, or unsupported presentation values retain a readable text fallback.

## Outcome row

A settled `publish_outcome` result renders its own immutable revision, title, Markdown summary, and run/chart/message evidence labels. Exact chart citations resolve against the current client-safe `science` projection and reuse the same attachment loader for thumbnails. A missing projection, chart version, or attachment leaves the publication text and evidence identity visible and reports the unavailable visual.

## Settings card

The card registers into `settings.plugin.item` under the fixed `science-runtime` namespace — the namespace `@deepseek-ai/dsh-science-runtime/with-settings` registers, not a package or product id — so it appears whenever the Host serves that namespace and stays absent otherwise, with no navigation row or Host change of its own. It binds the namespace through `ctx.settingsScope` and edits only `['science', 'pythonPrefix']` and `['science', 'rPrefix']` (the section root is the profile map itself, addressed by the fixed `science` profile id, not a `profiles` wrapper field), plus `unsetPath(['science'])` for the explicit remove-override action; no code path writes the section root. Both fields are `role('secret')`, so their stored value never rides a settings response — the card learns per-field presence from `SettingsScopeSnapshot.secrets` and never echoes a stored path back into an input. A blank replacement input is a no-op, and every successful change is labeled restart-required, matching the Runtime's restart-only resolution. The card owns its own staging and revision fencing rather than importing the Plugins section's card chrome or staged-form model as values, which the bundle-purity gate forbids. Its chrome is built on `@deepseek-ai/dsh-client-ui-primitives`' shared atoms — `Input` for both prefix fields, `Pill` for the Configured/Not configured badge, and `Button` for Save/Discard/Remove override — rather than raw unstyled elements, so the card matches the app's own controls; only the card container's border/radius/background and the collapsed-by-default header/chevron layout, none of which any primitive provides, are this package's own CSS. Collapsed, only the header (name, description, and the expand toggle) is in the accessibility tree — every field, hint, and action button renders only once expanded, matching every sibling card's behavior and accessible-naming register.

## Header action and Details entry

The header action registers into `conversation.session.header.actions` and renders nothing at all unless the current Session summary's `agentPreset` names the built-in `science` preset — a Standard or custom non-Science Session shows no action, and no Session ever opens the Details column automatically. Activating it calls the owner-supplied `openDetailsView('science')`; it opens no panel of its own.

The Details entry registers into `conversation.details.view` with id `science` and a registered label from the `science` namespace. It is read-only and renders from the same `science` Session projection the chart/Outcome rows read: a client-safe environment summary (profile, revision, and per-language capability/version/fingerprint preview — never a Host path, executable, or full fingerprint), ordered run status/history, every logical chart at its latest accepted version with a thumbnail, and the latest Outcome with its evidence references. Before the first Science event it shows the selected preset and an unbound state. Missing projection support (the Host composes no `science` projection unit), an unavailable chart attachment, failed Runtime binding (no environment revision, or one whose `status` is not `'applied'`), no runs, no charts, and no Outcome each render distinct text — no state ever reads as "Runtime ready" from a merely configured prefix, because environment capability comes only from a durable `'applied'` binding.

Chart thumbnails resolve through this package's own session-scoped loader (`science-attachment-loader.ts`), not the conversation-owned one the transcript rows use: the Details entry's owner share carries nothing (`DetailsViewOwnerProps`), so it calls `ISession.readAttachment` directly and converts the returned bytes to a `data:` URI with no `Map` and no `URL.createObjectURL` handle — nothing to revoke on session release, and no second cache alongside the conversation loader's own.

## Composition

Load this browser plugin after `@deepseek-ai/dsh-client-ui-tool`, `@deepseek-ai/dsh-client-ui-attachment`, `@deepseek-ai/dsh-client-ui-conversation` (the header-action and Details-view seats), the client locale/runtime packages, `@deepseek-ai/dsh-client-ui-settings` (`ctx.settingsScope`), and a Host composition that exposes the `science` Session projection. The shipped Web bundle mounts `@deepseek-ai/dsh-science-runtime/with-settings` with an intentionally empty profile map, so the card appears with an unconfigured `science` profile until a person names Python/R Conda prefixes and restarts the Host; CLI and headless bundles keep their own explicit Runtime composition and show no card.

## Model Experience

None, as the transcript rows render already-logged Tool results, the settings card edits deployment configuration, and the header action/Details entry only read current-state Session projection; none changes a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **PNG presentation only** — Science version one saves PNG charts, so this package has no generic chart-specification or non-image renderer.
- **No independent attachment cache** — the transcript rows' thumbnails ride the conversation-owned session attachment loader (owner-supplied `loadImage`), whose lifetime, retry, and object-URL revocation stay owned there. The Details entry's thumbnails resolve through its own stateless `data:`-URI conversion over `ISession.readAttachment` (no owner share carries a loader to reach); neither path adds a persistent Map-based cache of its own.
- **One fixed profile, two fields** — the card edits only the shipped `science` profile's `pythonPrefix`/`rPrefix`, because the built-in preset is the only current product consumer; another deployment profile id remains a file/configuration concern, not a browser-managed one.
- **No discovery, probing, or live apply** — the card never lists, probes, or validates a Conda environment and carries no filesystem picker or live-apply control; a stored prefix is opaque until a Host restart binds it.
