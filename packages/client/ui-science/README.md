# @deepseek-ai/dsh-client-ui-science

English | [中文](README.zh.md)

Browser presentation for Science tool results, settings, Files and Outcomes destinations, artifact previews, and turn-local artifact traces. It consumes frozen conversation data and the client-safe Science projections; durable writes go through Host Remotes.

## Transcript rows and turn traces

`run_python`, `run_r`, `annotate_artifact`, and `publish_outcome` register keyed `tool.call.toolview` entries. Run results retain their rendered status/stdout/stderr and append exact-version file references from tagged presentation metadata. Artifact results render one compact file reference, and Outcome results render their immutable revision and evidence.

Every assistant turn that produced an artifact receives a `conversation.chat.turnTail` entry: `This turn produced N files · View trace`. Expanding it shows exactly three compact rows: the preceding user request, structured execution/file counts, and versioned run/file actions. Long text truncates within its row at narrow widths. A run action expands code, output, and environment revision facts resolved from the durable call and Science projection; an artifact action opens that exact version. Assistant prose is not repeated because the complete answer is already adjacent in chat.

## Selection store

`selection-store.ts` owns only artifact viewing state: ordered exact-version tabs, the active artifact id, and lightbox state. The viewer and transcript file references receive the same store handle, so one session-scoped instance coordinates them. There is no viewer-mode or provenance-subtab state.

## Artifact viewer

The `science` Details entry is an object-state viewer. Its persistent content is limited to the artifact preview, exact-version history, user-only notes, and a jump to the assistant message that produced the selected version. It has no Diff or Provenance view and no persistent Trace or semantic-lane control.

Preview dispatch follows the durable media type: images use `MessageImage`; CSV uses the bounded sortable table (`ArtifactTable.tsx`); JSON uses `JsonTree`; Vega-Lite JSON uses the bundled SVG renderer; Markdown uses `MarkdownText`; and plain text uses a bounded `<pre>`. A CSV table renders at most `MAX_ARTIFACT_TABLE_ROWS` (500) rows, and non-CSV text is capped to `MAX_ARTIFACT_TEXT_CHARACTERS` (100,000) characters before a JSON parse attempt or a `<pre>` render — fixed presentation bounds (`format.ts`), independent of the deployment's own attachment byte cap; a capped render shows a "showing first N" notice. CSV parsing (`csv.ts`) is a hand-rolled, RFC4180-style parser rather than a dependency: this is a read-only preview over auto-captured or model-annotated files, never arbitrary untrusted upload, and no second table consumer exists elsewhere in `packages/client` to justify a shared primitive. Download resolves the selected version through the session-scoped attachment loader. Image maximize uses the shared lightbox.

Vega-Lite structural selections and raster regions can be staged into the main composer with an optional per-target comment. Direct Vega-Lite style edits commit a complete JSON working copy as a human-edit version through `scienceEdits.commitStyleEdit`. The viewer contains no independent model instruction field.

Notes apply uniformly to every artifact media type. The viewer lists notes by logical artifact with their add-event sequence, visible version, and timestamp; users can add plain text or delete an active note through `scienceEdits.addArtifactNote` and `scienceEdits.removeArtifactNote`. Notes are projected separately from model-visible Science state and never enter a prompt.

With no active tab, Files shows the latest version of every logical artifact. Outcome remains on the independent `science-outcomes` Details route.

## Settings and shell composition

The `science-runtime` settings card edits the fixed `science` profile's Python and R prefixes through `ctx.settingsScope`; both paths are secret roles and stored values are never echoed into inputs. The card distinguishes effective, pending-restart, and unconfigured state from the Host-provided snapshot.

Files-toggle placement is selected by the validated Host `toggleScope`: `session` registers the Science-session utility and blank Science-session handoff, while `global` registers one unconditional page utility for the desktop composition. Sidebar destinations, composer target chips, and kernel status remain gated to Science sessions.

## Model Experience

None, as artifact previews, version selection, downloads, direct style edits, notes, and turn traces add no model input; only submitting staged artifact targets through the main composer creates the existing structured `science-edit` user message.

#### KV Cache effect

These user-only surfaces do not change model requests, so they do not invalidate or extend the model-side KV cache.

## Known Limitations and Deferred Work

- Notes support add and delete, not edit.
- Turn traces report facts already present in durable events; package installation and manual-operation rows require an authoritative event before they can appear.
- A text artifact past its render cap is not fully browsable in place — `MAX_ARTIFACT_TABLE_ROWS`/`MAX_ARTIFACT_TEXT_CHARACTERS` (`format.ts`) stop the table/text render before the whole payload reaches the DOM, so a table sorts and a JSON document parses over the shown prefix only, and a truncated `.vl.json` almost never re-parses, so an oversized Vega-Lite artifact shows capped raw text instead of a chart; download still recovers the complete durable bytes.
- Deterministic PNG/PDF export and R/Python prompt or tool optimization remain outside this package.
