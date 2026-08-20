# Agent Note: An artifact version is what one request turn produced

Status: implemented

English | [中文](2026-08-19-artifact-version-per-request-turn.zh.md)

## Problem

Science defined an artifact version as one durable save of a logical file, which is the Runtime's own view of its work rather than the reader's. Two consequences followed from that definition, and hands-on use hit both at once.

The shipped system prompt tells the model that run-written files are captured automatically and then directs it to `annotate_artifact` "the artifact that best demonstrates your result" so the reader sees a title. Auto-capture committed v1 titled from the file's basename; the curation call re-committed the *same content-addressed attachment* as v2 with a title. Every well-behaved chart therefore ended as two versions holding byte-identical pixels, and the artifact panel presented that duplicate as a version history. The model did nothing wrong: the prompt asked for a title and the durable model charged a version for it.

The same definition also counted iteration as history. A model debugging its own plotting code rewrites `chart.png` three or four times while answering one request; each rewrite became a version the reader had to page through, though the reader asked one question and wanted one answer.

## Decision

A version is the content one request turn produced. The source run's authorizing `tool/call.turn` is the turn anchor; `requestHeaderSeq` remains authorization provenance and may cover calls from more than one turn, so the rule needs no new tracked state or event type. The [persistent-kernel source-run and abort presentation fix](../bug-fix/2026-08-20-persistent-kernel-artifact-turn-and-abort-presentation.md) corrects that implementation detail while retaining this reader-visible rule.

`science/artifact-saved` now either opens the next contiguous version or supersedes an existing one in place. `applyArtifactSaved` (`packages/science/science-session/src/transition.ts`) admits changed bytes only for `origin: 'auto'` when the source run repeats the target version's source run `tool/call.turn`; an `origin: 'model'` curation must repeat the target's attachment byte for byte. Either origin may supersede an unchanged attachment in any turn.

A save that changes content in a new turn must open the next version; reusing a version number there is rejected, as is a supersede that renames the `artifactId` or backdates the version's `createdAt`. Both saves stay in the durable log — only the projected version list collapses — and the version's retained `IndexedArtifactFact` follows the superseding event, so Outcome evidence cited against a version is dated by the save that produced what that version currently holds.

The two producers compute the version the fold then validates. Auto-capture (`science-runtime/src/capture.ts`) keeps `latest.version` when the source run shares the current version's source `tool/call.turn` and otherwise advances it; its existing content-hash skip still drops a byte-identical rerun before either path. Curation (`ScienceRuntime.annotateArtifact`) commits the source version's own number, so titling never advances what a reader sees.

`origin` survives with a sharpened meaning: it now describes one version's *current* metadata — `auto` for a capture-titled version, `model` for one the model deliberately titled — rather than distinguishing two versions. That is the marker the artifact panel needs to show the curated result first, and it stays a two-value enum with both values still produced.

`createdAt` correspondingly means when the version's current content and metadata were committed, not when an immutable attachment first landed.

## Alternatives considered

**A dedicated `science/artifact-annotated` event carrying metadata only.** This was the first fix drafted for the duplicate-version defect alone, and it is the narrower change: annotation becomes an overlay the fold applies to a named version, and the content path keeps "one save, one version". It fixes the v1/v2 duplicate but not the iteration noise, because four runs in one turn still produce four versions. It also costs a new `SessionEventMap` member, its codec, projection schema, and client rendering — more durable surface than the accepted rule, for strictly less of the problem. The accepted model-capture rule keeps annotation metadata-only by requiring its attachment to remain unchanged.

**Prompt-only: tell the model to annotate less.** Half an hour of work, and it leaves the data model defining a version as a save. Any model that follows the shipped instruction to title its best result still mints a byte-identical version, so the defect returns whenever the model behaves as asked.

**Collapse byte-identical adjacent versions in the artifact panel.** Presentation-only, and dishonest: the durable log, `get_science_state`, and the `annotate_artifact` receipt all still say v2, so the model reasons about a version the reader is not shown.

**Keep within-turn iterations, nested under their turn's version.** Preserves the intermediate outputs a supersede discards, at the cost of a second level in the projection and in the panel. Rejected because the intermediates are the model's debugging residue rather than results, and they remain recoverable: every save stays in the session log, and each run keeps its own transcript row.

## Consequences

One request turn yields one version per logical artifact, so the panel's version list reads as the reader's own sequence of requests — "draw the scatter", "add the regression line", "make it log scale" — instead of the run-to-run iteration behind it. `annotate_artifact` costs no version at all.

What this gives up: an intermediate file written and then overwritten inside one turn is no longer reachable as a version. The superseded save remains in the durable log, and the run that wrote it keeps its transcript row, but no projected surface lists it. A reader who wants to compare a model's third attempt against its fourth cannot do so from the artifact panel.

The fold gained a rejection a producer can now hit: committing changed content under an existing version number from a later turn fails loud rather than silently overwriting a result the reader already saw.

Existing sessions are unaffected in the only sense that matters pre-release — no on-disk migration exists, and a log recorded under the old rule still folds, since every version in it advances contiguously.

## Testing

`packages/science/science-session/tests/fold.spec.ts` covers same-turn supersede (including the retained fact moving to the superseding event), cross-turn curation by unchanged attachment, cross-turn content rejection, and the rename/backdate rejections. `packages/science/science-runtime/tests/capture.spec.ts` proves a second run inside one turn supersedes rather than versions, keeping the turn's final content and both durable saves. The `science-tools` headless snapshot is the assembled-application evidence: its transcript now reports `v1` from the curation receipt and cites `chart@1`, and its mock model derives the cited version from the receipt rather than from a fixture constant, so the fixture no longer encodes a version number of its own.
