# Agent Note: Verbatim image admission for Science artifact capture

Status: implemented

English | [中文](2026-08-22-science-verbatim-image-capture.zh.md)

## Problem

The attachment store's image admission runs a normalization pipeline (EXIF orientation, metadata stripping, sRGB conversion, long-edge downscaling to `normalizedImageMaxDimension`, format candidates). That is correct for chat uploads consumed by models and browsers, but Science auto-capture stores scientific evidence: a captured version's bytes must read back exactly as the run wrote them. Matplotlib output routinely carries a `Software` metadata chunk and can exceed the normalization dimension cap, so normalization rewrote captured plot bytes, and a downscaled reference gained `originalDimensions` — a key the strict `science/artifact-saved` codec rejects, failing the whole `run_python` call after a successful run.

## Decision

`SaveImageAttachment` carries an explicit admission route: `normalization?: 'normalize' | 'verbatim'`, defaulting to `'normalize'`. The verbatim route keeps full decode verification and every source admission limit (byte cap, pixel and dimension caps, declared-type match) but stores the submitted bytes exactly as given — no metadata, color, encoding, or dimension changes, and the normalized-image byte cap does not apply. A verbatim reference digests the source bytes and never carries `originalDimensions`. Science capture (`science-runtime`'s `captureRunArtifacts`) submits images verbatim.

The strict Science codec keeps rejecting `originalDimensions`: with capture verbatim by construction, a normalized reference reaching a Science event indicates a producer bug, and the strict schema surfaces it loudly rather than admitting silently rewritten evidence.

## Consequences

Science capture can promise byte-identical evidence while chat uploads retain normalized storage. Callers that require verbatim persistence must opt in for each image, and the attachment store remains responsible for full decode verification and source admission limits on both routes.

## Alternatives considered

- A store-wide or per-store-instance policy toggle: the route is a per-call fact of each submission, so one store serves chat normalization and Science evidence simultaneously.
- Widening the Science codec to accept normalized references: that would trade the byte-exactness guarantee for tolerance of exactly the rewriting this decision exists to prevent.

## Verification

`attachment-local` store tests prove a verbatim submission reads back byte-identical where the normalize route rewrites (downscale case), keeps admission rejections (type mismatch, byte cap), and never emits `originalDimensions`. A `science-runtime` capture test drives a real store end-to-end with a metadata-carrying PNG and compares the read-back bytes to the written file. The opt-in real-Conda acceptance's curated-chart read-back check exercises the same contract against real interpreters.
