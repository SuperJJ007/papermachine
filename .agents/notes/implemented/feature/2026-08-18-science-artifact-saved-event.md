# Agent Note: `science/artifact-saved` replaces `science/chart-saved`

Status: implemented

English | [中文](2026-08-18-science-artifact-saved-event.zh.md)

## Problem

`dsh-science-session` modeled every saved figure as a `ScienceChartVersion` carried by a `science/chart-saved` event, with `mediaType: z.literal('image/png')` baked directly into the durable codec. File-centric artifact capture (auto-importing any run-written `.csv`/`.json`/`.md`/`.png`/`.txt` as a versioned artifact, and letting the model curate a version's title/caption after the fact) needs a durable record that is not intrinsically PNG-shaped, carries a populated `title` regardless of whether a human supplied one, and distinguishes an unattended capture from a model-directed save. Widening `chartSchema` in place would have required relaxing its `image/png` literal for a concept the schema's own docstring already flagged as a deliberate v1 narrowing ("Science version one requires PNG"), and would have left the vocabulary calling every future non-image artifact a "chart."

## Decision

`science/chart-saved` is retired and replaced by `science/artifact-saved`, carrying one `ScienceArtifactVersion`:

```ts
import type { ImageAttachmentRef, TextAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ScienceArtifactId, ScienceRunId } from '@deepseek-ai/dsh-science-session'

export interface ScienceArtifactVersion {
  readonly artifactId: ScienceArtifactId       // was ScienceChartId / chartId
  readonly logicalName: string
  readonly version: number
  readonly title: string                        // always populated
  readonly caption?: string
  readonly origin: 'auto' | 'model'             // unattended capture vs. curated save
  readonly attachment: ImageAttachmentRef | TextAttachmentRef
  readonly runId: ScienceRunId
  readonly toolCallId: CallId
  readonly requestHeaderSeq: number
  readonly environmentRevision: number
  readonly environmentFingerprint: string
  readonly createdAt: number
}
```

Every science-session layer follows the rename mechanically: `domain.ts` (`ScienceArtifactSavedEvent`, the `SessionAttachmentExtractorMap` key), `codec.ts` (`artifactSchema` replacing `chartSchema`, `decodeScienceArtifact`), `transition.ts` (`applyArtifactSaved`, `state.artifacts`/`state.artifactFacts`), `fold-state.ts`, `projection-value.ts` (`clientArtifact`), `projection-schema.ts`/`projection-fold-codec.ts`/`projection-private.ts`/`projection-witness.ts`, and `ids.ts` (`ScienceArtifactId` brand, `SCIENCE_PROJECTION_STATE_VERSION` bumped `2` → `3` since the persisted checkpoint's field names changed). `ScienceProjection.artifacts` and `ScienceProjectionMetrics.artifactCount`/`artifactVersionCount` replace `.charts`/`chartCount`/`chartVersionCount`; `ScienceClientArtifactVersion` replaces `ScienceClientChartVersion`.

The fold applies no content-hash dedup: a curation-only re-save that repeats an identical `attachment` with a changed `title`, `caption`, or `origin` still commits the next contiguous version. Deciding whether an unchanged file deserves a new version at all is the future auto-capture caller's job, not this package's — matching the existing pattern where `transition.ts` validates provenance and ordering but never inspects attachment content.

`science-runtime`'s `commitChart` now builds a `ScienceArtifactVersion` and appends `science/artifact-saved` with `origin: 'model'` (a `save_chart` import is always a curated, model-directed save); its own name, request/response shapes, and error codes are unchanged here — `commitChart` and `save_chart` are retired and replaced by `annotateArtifact`/`annotate_artifact` in [retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.md). `tool-science` and `ui-science` read the renamed durable/projection fields internally but keep every model-visible and user-visible name unchanged: `get_science_state`'s output still returns `charts`/`chartId`/`chartCount`/`chartVersionCount`, `publish_outcome`'s evidence schema still accepts `{kind: "chart", chart_id, version}`, and `ui-science`'s own selection-store vocabulary (`ScienceOpenArtifact.chartId`, `activeChartId`, `openTab({chartId, version})`) is untouched — only the branded type each field carries changed, from `ScienceChartId` to `ScienceArtifactId`. `ScienceChartEvidenceRef` (the `publish_outcome` evidence-citation shape) keeps its `kind: 'chart'` / `chartId` field name for the same reason: citation vocabulary is a distinct, unrenamed concept from the artifact record it points at, and its `chartId` field's type follows the `ScienceArtifactId` rename without the field itself renaming.

`SESSION_FORMAT_VERSION` stays `0`: this is a Science-domain event-vocabulary change, not a change to the generic session-log envelope.

## Alternatives considered

**Widen `chartSchema`'s `mediaType` union in place instead of a new event type.** Rejected: the schema's own `image/png` literal was a deliberate v1 narrowing, and the `chart`/`ScienceChartVersion` names would have stayed permanently attached to a concept that no longer means "chart."

**A parallel `science/file-saved` event beside a frozen `chart-saved`.** Rejected: it permanently duplicates fold/codec/projection/checkpoint code for two concepts differing only in media type and curation fields, forever, to save one fixture-regeneration pass paid once.

**Rename the model-facing tool surface (`save_chart`'s schema, `get_science_state`'s `charts` field, `publish_outcome`'s evidence `kind`) in the same change.** Rejected: the durable-model rename and the tool-surface rename are independent decisions with independent snapshot costs. Keeping every model-visible string unchanged here means this decision carries zero model-visible behavior change to snapshot; `save_chart`'s retirement and `annotate_artifact`'s introduction are recorded in [retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.md).

**Rename `ScienceChartEvidenceRef`'s `kind`/`chartId` to `'artifact'`/`artifactId`.** Rejected: `publish_outcome`'s evidence-citation vocabulary is a separate tool-facing contract from the artifact record; renaming it would have forced a `publish_outcome` snapshot and test update for a citation shape that isn't part of this change's actual scope, for a field whose type already correctly follows the `ScienceArtifactId` rename.

## Consequences

Every fixture embedding `science/chart-saved` needed regeneration in this same change: `science-session/tests` (11 spec files), `science-runtime/tests`, `tool-science/tests`, `ui-science/tests` (6 spec files), `session-attachment-index/tests`, `host/apiproxy/tests/session-export.spec.ts`, the `apps/web` Science e2e/snapshot fixtures, and `examples/headless-agent`'s keyless snapshot expectations (refreshed via `DSH_SNAPSHOT=refresh`, no model key needed since the scenario runs a scripted mock LLM). The generated `docs/persistence-catalog.md`, `docs/tool-catalog.md`, and the `## Cordis API` region of `docs/subsystems/science.md` (plus their `.zh.md` pairs) needed regeneration; `scripts/gen-tool-catalog.ts` carried a hardcoded `'science/chart-saved'` string in its catalog-row config (not derived from source) that needed a matching manual edit, and `scripts/gen-cordis-catalog.ts`'s `linkedTypePages` map needed `ScienceChartVersion` renamed to `ScienceArtifactVersion` before the generator's type-link coverage check would pass.

The `attachment: ImageAttachmentRef | TextAttachmentRef` union this note originally deferred, and `applyArtifactSaved`'s success-only source-run gate and per-save fresh-tool-call consumption, landed together with runtime auto-capture; see [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.md).
