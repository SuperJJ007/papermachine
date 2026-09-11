# Agent Note: Science request ownership follows recorded turns

Status: implemented

English | [中文](2026-09-10-science-request-turn-ownership.zh.md)

## Problem

A turn can fail before a user message is admitted. Counting visible user messages then assigns later requests to the wrong Process card; pagination also makes that count incomplete.

## Decision

Science Process assigns request and steering text by the trace turn interval containing the node's log sequence. Recorded start and end sequences are inclusive; an open turn has no end bound. Text outside every recorded interval is omitted. Visible-message counting remains available only when the projection has no trace turns.

The [one-send-one-turn decision](../simplification/2026-07-17-one-send-one-turn.md) remains the loop's independent lifecycle authority. Presentation consumes its recorded turns without inferring successful admission from a start event.

The sparse Science projection witness retains turn ends before mode binding as well as starts. Projection state version 19 rebuilds older cached rows from the unchanged Session log; otherwise an omitted end can leave an earlier turn open across subsequent requests.

## Alternatives considered

Counting loaded messages loses failed and unloaded turns. Timestamp matching cannot distinguish adjacent events recorded at the same time. Assigning unmatched text to the latest turn invents an ownership relationship.

## Consequences

Requests retain their recorded turn when history pages change. A missing request stays unavailable instead of borrowing another turn's text. Unit coverage includes closed and open intervals, unmatched sequences, steering and equal timestamps; the real Web fixture includes a failed startup before message admission and verifies the next turn's visible request.
