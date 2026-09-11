# Agent Note: restore same-turn Science draft folding from store producer facts

Status: implemented

English | [中文](2026-09-02-science-same-turn-draft-folding-restoration.zh.md)

## Problem

Same-turn intermediate drafts should be less prominent without deleting immutable versions or mistaking another session’s turn counter for the current one.

## Decision

The authorized version-summary batch supplies exact content origin, producer session, and producer turn. A version folds only when a strictly later version of the same artifact has the same producer session and turn. Human edits remain exempt; run-auto and imported versions obey the same identity rule when producer coordinates exist. Missing summaries or turns leave versions walkable.

Native artifact panes remove folded versions from the default stepper walk only. A directly opened folded version remains in its own walk so adjacent controls can leave it. The fold returns version numbers and never mutates stored data.

## Alternatives considered

**Duplicate producer fields into the session projection.** This creates a second provenance authority.

**Use the viewing session and its turn counter.** A project chain can contain versions from several producers.

**Delete or make folded versions unreachable.** Exact links and historical analysis would lose their targets.

## Consequences

Folding is presentation only, with no intermediate-draft toggle required. Tests need cross-session turn collisions, missing metadata, human edits, arbitrary input order, and directly opened folded versions; a same-session happy path cannot prove the ownership rule.

## Related

Related owners: [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md); [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md).
