# Agent Note: Isolate and bound cold chart recovery

Status: implemented

English | [中文](2026-08-31-science-cold-replay-isolation.zh.md)

## Problem

Replaying expired chart source inside the analysis kernel silently overwrites current variables and mutates shared objects without a scientific execution record. A preview can therefore change subsequent results. An unbounded private RUN also ignores cancellation and can retain the session operation lease indefinitely.

## Decision

Cold recovery runs the exact source and immutable materialized inputs in a disposable interpreter process. Its writable root, home, state directory, and package-install tree are inside unpublished replay scratch. It shares neither Python objects, modules, and environment nor R objects, environments, and options with the analysis process. Recovery allocates no persistent kernel epoch and emits no scientific run or kernel-state event. Normal runs retain their persistent process and authorization rules.

Recovery uses `settleKernelExecution` with the existing operation control: cancellation and timeout interrupt first, then require process teardown. Chart application also receives the operation signal. The lease remains held through recovery-process quiescence and scratch removal, and a preview rechecks cancellation before returning. Recovery failures never retire the unrelated analysis kernel; a failed warm chart exchange still retires its own protocol-faulted kernel.

The [saved-baseline decision](2026-08-31-chart-edit-baseline-isolation.md) continues to own immutable export snapshots, source-version selection, and cumulative operations. The broader [live-figure proposal](../../proposed/architecture/2026-08-28-science-live-figure-editing.md) retains its independent catalog and viewer decisions.

## Alternatives considered

**Save and restore selected globals.** This misses aliases, in-place mutation, module state, R reference environments, options, and cancellation during restoration.

**Evaluate in a fresh dictionary or R environment within the analysis process.** Modules, environment variables, library state, and process-wide settings remain shared. R parent environments and superassignment add further escape paths.

**Record recovery as an ordinary scientific run.** This changes analysis state merely to inspect an old figure and alters the scientific history for preview/discard. Isolated recovery preserves that operation's observational purpose.

## Consequences

Cold recovery incurs interpreter startup cost and cannot use undeclared objects or packages installed only in the current analysis kernel. Such source fails with `CHART_NOT_ADDRESSABLE`; the user must rerun the analysis to regenerate the figure. Recovery is not a general rollback of external side effects: it retains the product sandbox's existing read and temporary-directory policy. Warm rendering remains a copy of the saved figure.

Real Python/R regressions cover scalar assignments, mutable objects, process settings, and cancelled or timed-out infinite replay. They assert the original kernel epoch and values survive, with no private execution events and no surviving recovery process. Runtime tests cover warm/cold chart cancellation, lease reuse, exact-version validation, and scratch cleanup. The runnable keyless snapshot expires old registrations and pins later execution counters so hidden analysis-kernel replay changes its transcript.
