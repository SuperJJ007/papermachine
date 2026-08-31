# Agent Note: Remove the intermediate-drafts toggle

Status: implemented

English | [中文](2026-09-01-remove-intermediate-toggle.zh.md)

## Problem

The artifact toolbar's version stepper (`ScienceDetailsView.tsx`) carried an "Intermediate drafts ×*N*" toggle: clicking it temporarily widened the stepper's walk order to include same-turn intermediate drafts — versions folded out of the default walk by `foldIntermediateVersions` (`intermediate-versions.ts`, C2) because a later version in the same turn and producing session already supersedes them. The product owner's explicit verdict on 2026-08-31 was that this entry point was never wanted: a user reviewing artifacts has no use for a model's same-turn self-check re-render, and the toggle only ever exposed exactly what the fold was built to hide.

## Decision

This decision deleted the toggle button, its `showIntermediates` component-local state and the tab-switch reset effect that guarded it, and the two locale keys it used (`toolbar.intermediateExpand`, `toolbar.intermediateCollapse`, both languages) and their now-orphaned CSS (`.intermediateToggle` and its `:hover`/`[aria-pressed="true"]` rules). `foldIntermediateVersions` and the default-skip behavior it drives stay: the stepper's `walkable` list is now unconditionally `versions` minus the folded set, with the currently open version always exempt from its own fold (unchanged — a provenance drill-in or a direct link can still open an intermediate draft directly). Removing the toggle does not orphan the fold: the fold is the mechanism that keeps intermediate drafts off the walk order by default, and that default is the entire point once no toggle can widen it back.

## Alternatives considered

**Remove `foldIntermediateVersions` along with the toggle.** Rejected: the fold is not toggle-only plumbing — it is the one thing making intermediate drafts invisible by default. Deleting it would have handed every same-turn self-check re-render back to the stepper's default walk, the opposite of what the product owner asked for.

**Keep the toggle but hide it behind a settings flag.** Rejected: no current consumer asked for a way to reveal intermediate drafts, and a dead settings flag with no reachable UI is exactly the kind of unused configurability the package conventions reject.

**Keep the locale keys for a future re-introduction.** Rejected: an unused, untranslated-by-nothing locale key is dead weight the moment its last reference is deleted; a future reintroduction adds new keys under a name matching whatever new entry point it builds.

## Consequences

The version stepper now has one behavior with no configurability: it silently skips a same-turn intermediate draft unless that draft is the tab's own currently open version. A user can no longer discover or reach a same-turn intermediate draft from the toolbar at all — the durable data remains reachable only through the provenance drill-in or a direct link, unchanged from before this removal. `ScienceDetailsView.client.spec.tsx` keeps one test asserting the default skip and one asserting the currently-open-version exemption; both toggle-specific tests (rendering the button, expanding, collapsing) are gone. `intermediate-versions.client.spec.ts`, which covers the fold algorithm itself, is unchanged.
