# Agent Note: Per-run detection of a shared Conda prefix drifting under a Science session

Status: implemented

English | [中文](2026-09-06-science-shared-prefix-drift.zh.md)

## Problem

Sessions sharing a Conda prefix can observe different package state after one session installs a package. Continuing with a stale binding misstates the environment actually used.

## Decision

Before a run, Runtime compares the recorded Conda-history digest with the current regular, non-symlink history file. Missing, unreadable, directory, or symlink results count as drift. A match avoids interpreter probes; a mismatch materializes scratch and performs full re-observation before execution.

An applied drift observation can rebind and replace idle kernels. An unusable observation rejects the run with ENVIRONMENT_NOT_READY without appending an invalid binding that would strand the session. Requested installation separately records its mutation outcome. Runtime does not synchronize desktop applied-state files during a mid-session rebind.

## Alternatives considered

**Have every mutator append a new product event.** Manual Conda commands do not cooperate with the product.

**Watch once at bind time.** A per-run check is simpler and does not multiply long-lived watchers across sessions.

**Probe interpreters on every run.** This pays subprocess cost even when history is unchanged.

**Append an invalid drift revision.** A transient busy prefix would make later recovery impossible under binding rules.

**Add installation approval or update desktop applied state here.** Those are separate policy and persistence decisions, not consequences required by drift detection.

## Consequences

The check costs one history read per bound language and detects Conda/micromamba transactions, not manual pip or R package changes outside Conda history. It is per-run observation, not a lock against mutation during execution. Failure to read the digest must never be treated as permission to use stale state.

## Related

Related owners: [science-package-install](../feature/2026-09-01-science-package-install.md); [science-persistent-kernel](../architecture/2026-08-20-science-persistent-kernel.md).
