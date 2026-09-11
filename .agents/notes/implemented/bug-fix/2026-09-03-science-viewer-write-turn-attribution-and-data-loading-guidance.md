# Agent Note: Viewer-write turn attribution and data-loading prompt guidance

Status: implemented

English | [中文](2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.zh.md)

## Problem

A viewer save during an idle gap can drift onto a future turn if attribution is recomputed after asynchronous work. Data-loading guidance can likewise leave a user expecting an in-kernel table that was only read as text.

## Decision

Viewer writes capture the last started producer turn once at operation entry, before replay or store awaits. Store summaries transport that coordinate through current Science reads. Trace attribution prefers the projection coordinate, then stored producer turn, then the last declared turn start no later than creation time. If no turn qualifies, the version remains unassigned.

The persona directs tabular analysis through Python/R so the kernel actually holds the data. Annotation guidance permits checking a requested name and reporting absence rather than creating a substitute file. These facts have one prompt owner each.

## Alternatives considered

**Resolve turn ownership after the write finishes.** A newly started turn would move the same artifact.

**Invent an open tool-call owner for a viewer action.** The user action has no authorizing model call.

**Keep latest-turn fallback for old records.** Coordinate-free versions would still drift.

**Repeat persona rules in shared guidance.** This adds fixed tokens without a new responsibility.

## Consequences

Entry-time attribution remains stable through later turns. Unknown historical coordinates stay unknown. Prompt guidance changes tool choice without adding a new schema or making filesystem text reads equivalent to loading a DataFrame.

## Related

Related owners: [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md); [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md).
