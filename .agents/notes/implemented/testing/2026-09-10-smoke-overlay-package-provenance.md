# Agent Note: Smoke overlay package provenance

Status: implemented

English | [中文](2026-09-10-smoke-overlay-package-provenance.zh.md)

## Problem

Source-mode smoke tests resolve workspace imports through tsconfig paths, while a shipped profile's Node module fallback contains its installation dependency closure. A test overlay can therefore load a plugin whose manifest is unavailable to active-package inventory. Disabling inventory makes the transcript pass without preserving the enabled request-preparation behavior.

## Decision

The [loader-smoke harness](../../../../packages/test-support/loader-smoke/README.md#overlay-package-provenance) owns explicit `profilePackages` mappings for overlay-only packages. It validates the real directory's name and version and creates package links only inside the test-owned home before launching the shipped CLI. The headless adapter explicitly supplies replay and per-composition package directories for PTY, LSP, product subagents, ACP subagents and the Python code runtime. The product dependency graph, profile configuration, inventory collector and request comparison remain unchanged.

The installer reuses a link already prepared by a snapshot patch only when its canonical directory matches the declared package directory; a conflicting target still fails before launch. The owning tests cover both cases and resolve the linked manifest from a profile path, reject missing or mismatched packages and unowned homes, and check cleanup. Recorded-session replay exercises the complete inventory-enabled application. An unresolved package continues to fail; successful model replay cannot substitute for this check.

## Alternatives considered

**Disable request inventory:** bypasses an enabled feature and its failure semantics, even though the metadata is absent from the model transcript.

**Add test providers to product dependencies:** makes a test assembly concern part of the shipped installation.

**Broaden runtime resolution to the workspace tsconfig:** couples product manifest discovery to a development-only source launcher. Explicit real package directories keep that dependency in the test harness.

ACP and SDK replay also declare these mappings. In built mode, an absent replay package can fail tree activation before a provider registers; requests during partial teardown can then expose closed persistence handles or inactive contexts instead of the original import failure. ACP goal and corpus comparisons, plus SDK corpus comparisons, exercise the real built profiles with inventory enabled and unchanged expected output. The shared installer rejects missing or mismatched packages before protocol startup, and the ACP harness proves cleanup after those refusals.

## Consequences

Test authors declare package provenance separately from their Cordis overlay rows. Both refer to actual package identities; no synthetic metadata hides missing packages. Built-mode tests still require real built exports. Existing profile fallback and snapshot ownership decisions remain active; this note records only test overlay assembly.
