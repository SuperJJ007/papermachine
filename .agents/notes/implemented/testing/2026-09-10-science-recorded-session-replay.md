# Agent Note: Science recorded-session replay

Status: implemented

English | [中文](2026-09-10-science-recorded-session-replay.zh.md)

## Problem

Science emits environment observations, kernel clocks and artifact identities into both durable events and model-visible state. Independent runs cannot compare their machine-specific values literally, while removing entire payloads would conceal binding errors and changes to the artifact presented to the user. A private executable driver also fails to test the shipped profile.

## Decision

The [headless adapter](../../../../snapshots/session/headless.snapshot.ts) drives the shipped Science profile with an isolated application home and a package-owned exact-operation kernel fixture. Live API recordings retain the complete model turn; replay replaces the model provider and the expensive interpreter process, while the production tool pipeline, runtime, confinement and content-addressed store execute normally. The interpreter rejects a different Python source instead of accepting any requested program.

[Science normalization](../../../../packages/test-support/session-snapshot/src/science.ts) is limited to explicit service-owned fields. Authoritative events assign relationship-preserving tokens to observed interpreter locations, executable identities, environment fingerprints and scratch keys. The structured state result and its named runtime-context section use the same mapping. Semantic content and unknown events are not scrubbed. Environment-reference mismatches, changed hashes, changed versions and changed output sizes remain observable.

[Web preset replay](../../../../apps/web/tests/science-preset.snapshot.ts) compares the complete persisted Session and rendered transcript. Cold restoration explicitly converts a recorded live kernel into an interrupted kernel; artifact, environment, run and metric agreement is checked separately. Non-session chart preview and projection expectations remain with their owning runtime package or Web tests. The [snapshot package](../../../../packages/test-support/session-snapshot/README.md) owns operating details.

## Alternatives considered

**Literal environment recording:** interpreter paths, filesystem identities and clock readings make the same operation differ across machines and temporary homes.

**Broad text replacement or event removal:** this can erase user text, broken identity references, artifact hashes and runtime failures. Only identified Science fields and their owned projections are normalized.

**Replaying through the old executable driver:** it omits the public profile's preset mounting and application-home selection. The shipped CLI and standard Web scaffold remain the application paths under test.

## Consequences

The keyless cases prove the assembled Science transcript, immutable-version reuse, stored PNG bytes and cold/browser restoration. They do not prove interpreter compatibility or platform confinement; live production-kernel acceptance remains separate. A new recorded Python operation requires an explicit fixture update and independently verified output bytes. The existing general snapshot ownership and Web replay decisions remain active; this note adds Science-specific normalization and interpreter-fixture constraints rather than superseding them.
