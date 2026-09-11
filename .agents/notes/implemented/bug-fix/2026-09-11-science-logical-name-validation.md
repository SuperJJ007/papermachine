# Agent Note: Science logical names and materialized paths

Status: implemented

English | [中文](2026-09-11-science-logical-name-validation.zh.md)

## Problem

Artifact capture can discover filesystem names that durable decoding refuses. Saving such a name before validation leaves a Session whose later projection cannot reconstruct its own artifacts. Interpreter execution and artifact capture also have different failure outcomes.

## Decision

The artifact store owns pure logical-name validation shared by capture, store creation/reconstruction, and Science decoding. Names retain their exact Unicode and path segments. Capture validates the complete eligible batch before its first store or event write. Canonical containment, regular-file checks, symlink exclusion, and byte limits remain separate filesystem checks.

Logical identity and filesystem materialization have distinct requirements. Historical device names and trailing dots remain readable; only new input destinations reject Windows device names and trailing dots/spaces. Colon and reserved punctuation are rejected in identities too, preventing drive and alternate-data-stream paths. Edit baselines and raster declarations perform identity lookups, not file writes.

A capture failure is a safe category in the ordinary persisted tool result. It never rewrites the interpreter terminal fact. Invalid-name rejection saves no candidate; later filesystem or event failures may follow already committed versions. The logger retains internal diagnostics, while model output gives category-specific guidance.

## Alternatives considered

**Apply the strictest filesystem grammar to every historical name.** This would make previously accepted device names or trailing dots unreadable and create another recovery failure.

**Normalize or rename captured files.** Rewriting identities breaks exact lookup and can merge distinct names. Rejecting the complete batch preserves the original files and avoids partial publication caused by validation order.

**Report a failed Python run or suppress capture errors.** Both lose a meaningful outcome. The existing tool-result log records capture diagnostics without another Session format or event type.

## Consequences

The two predicates share traversal and encoding checks but intentionally differ on platform aliases. The [project-store ownership decision](../architecture/2026-08-25-project-artifact-store.md) remains authoritative for version identity.

Verification covers historical decoding, materialization rejection, batch atomicity before writes, unchanged persisted event replay, and a runnable recorded Science session with successful Unicode capture followed by capture rejection. The POSIX failure fixture creates an ADS-like name that Windows cannot create; Windows executes pure validation and input rejection tests instead. Recovery of private histories uses isolated copies and a local reply provider, preserving event bytes while relocating only the copied header's working directory.
