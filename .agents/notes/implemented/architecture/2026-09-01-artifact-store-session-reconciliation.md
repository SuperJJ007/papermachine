# Agent Note: Store ↔ session reconciliation, and W2/W3 narrowing at every append site

Status: implemented

English | [中文](2026-09-01-artifact-store-session-reconciliation.zh.md)

## Problem

The project database and session logs commit separately and have different lifetimes. Reconciliation must distinguish missing evidence from proof of absence without overwriting authoritative provenance.

## Decision

Reconciliation handles seven cases: matching references do nothing; absence from incomplete logs leaves rows unverified; absence from a complete scan marks an orphan; a dangling log reference reconstructs a row; a hash conflict yields a diagnostic and orphan status; metadata divergence does not overwrite historical snapshots; missing blob bytes mark the retained row as missing. Reconstruction uses actual blob size when available and a zero sentinel otherwise, with media type inferred conservatively.

Store and Runtime have separate configured version and session limits. Cursors bound both existing-version and dangling-reference work; failed items rotate so one failure cannot starve the rest. Session-set revisions and completeness govern reuse. Only a complete, error-free, cursor-free pass suppresses later work; delayed retry happens on a later resolution, not an automatic background loop.

Capture, annotation, chart save, and save-as share append-or-mark-orphan handling. If marking also fails, diagnostics preserve the original append failure. Health summaries aggregate all versions, not just the newest row. Ordinary orphan status is not presented as missing bytes; current Remote reads expose reconstructed and missing health independently.

## Alternatives considered

**Treat any unobserved event as absent.** A bounded or failed scan would incorrectly orphan valid versions.

**Rewrite store provenance from session snapshots.** Historical snapshots can legitimately lag later annotations.

**Retry an entire project immediately forever.** This creates unbounded work and lets one corrupt item prevent progress.

**Count only latest versions for health.** Older missing or reconstructed versions remain addressable and must not disappear from diagnostics.

## Consequences

Optional persistence cannot become a load-time requirement. Raw log inspection still validates durable fields; it does not make malformed input trusted. Reconciliation does not recover a terminated run with zero outputs, nor a capture failure before any row exists: detecting those needs separate run-versus-version accounting. Metadata repair cannot recover missing blob contents.

## Related

Related owners: [science-read-remotes](2026-09-09-science-read-remotes.md); [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.md).
