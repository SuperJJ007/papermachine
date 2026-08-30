# Agent Note: Science replies without a publication workflow

Status: implemented

English | [中文](2026-08-31-science-without-publication.zh.md)

## Problem

A separate conclusion publication tool prompts the agent to publish a result after answering. Element selection overlays obscure the chart being inspected, and empty reference markers imply meaning where no color exists.

## Decision

Science offers execution, state inspection, and artifact annotation. Results belong in ordinary assistant replies. The publication tool, its guidance, and Outcome fields in model-facing state are absent. Recorded Outcome events and their read-only presentation remain readable; this decision does not erase session history.

Element references preserve exact identities without drawing over the PNG. Only elements with a recorded color display a swatch, after the name. Explicit region selection remains available. Empty private-note inputs contain both the entry hint and privacy notice, separated by a newline; neither is submitted as note text.

## Alternatives considered

**Hide only the publication UI.** The agent still sees the tool and can call it. Removing the producer and model guidance closes that path.

**Delete recorded Outcome events.** Existing sessions contain useful run and artifact history alongside those events. Their strict replay remains independent of whether new publication is offered.

**Keep empty swatches or image overlays.** Neither is needed to reference an element by its exact identity, and both add visual noise.

## Consequences

There is no new evidence-backed publication revision. Reintroduction requires a deliberate product decision covering producer, model guidance, and presentation together. Component tests and artifact-viewer snapshots pin unobscured images, conditional trailing swatches, and placeholder-only privacy text; the tool catalog, assembled CLI preset, real Web preset, and headless snapshot pin the model tool roster without publication.

This partially supersedes [R5 publication](../feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md) and qualifies [transcript Outcome placement](../feature/2026-08-25-science-trajectory-and-transcript-ia.md) as recorded-history presentation. Both records retain independent attachment-authorization, replay, and transcript-layout rationale.
