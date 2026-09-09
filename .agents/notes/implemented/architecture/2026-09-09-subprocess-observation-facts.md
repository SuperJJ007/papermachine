# Agent Note: Subprocess execution and byte observations

Status: implemented

English | [中文](2026-09-09-subprocess-observation-facts.zh.md)

## Problem

Science owns local scratch paths and must reject a remote subprocess provider before touching those paths. Its fixed Unicode interpreter probe must distinguish malformed output bytes from a valid literal replacement character.

## Decision

The subprocess provider declares its execution world. Local reports `host-local`; E2B reports `remote`. Science checks that fact before operations on private Host scratch.

Collected reads report UTF-8 validity of the exact returned byte slice, before replacement decoding. Local and E2B retain raw bytes; both report valid or invalid. Unknown is reserved for decoded-only providers. A partial multibyte character is invalid in that read, while a subsequent complete read can be valid.

## Alternatives considered

**Inspect decoded replacement characters.** Rejected because valid input can contain U+FFFD and malformed input can decode to the same character.

**Infer location from service names or methods.** Rejected because a provider's actual execution world is an explicit implementation fact.

## Consequences

Consumers can validate local ownership and byte fidelity without obtaining a process id. Existing output text, offsets, loss, and spill behavior remain intact. Provider tests cover split multibyte input, partial offsets, literal replacement characters, and malformed bytes.

This RE-APPLY item affects subprocess declarations and local/E2B provider observations. Upstream retains the bytes but does not publish these facts. No upstream report is submitted with this commit. The native containment and proxy decisions are independently useful and remain active; neither is superseded.
