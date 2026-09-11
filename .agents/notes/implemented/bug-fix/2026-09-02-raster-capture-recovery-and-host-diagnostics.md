# Agent Note: Recoverable raster declarations and Desktop Host diagnostics

Status: implemented

English | [中文](2026-09-02-raster-capture-recovery-and-host-diagnostics.zh.md)

## Problem

A failed analysis can leave a useful declared raster, and a failed Host or provisioning process needs diagnostics before its final error is available.

## Decision

Capture can recover eligible declared PNG outputs after execution failure while preserving the failed run result. Missing or invalid files produce capture diagnostics rather than replacing the primary execution error. Product provisioning writes attempt output as it arrives; native desktop setup forwards the relevant diagnostic information through its current Host and IPC ownership.

Recovery does not broaden raster admission to every image in the workspace. Capture results and Host diagnostics remain distinct from model-visible success.

## Alternatives considered

**Discard outputs after every execution failure.** This loses diagnostic figures that can explain the failure.

**Persist only the final error string.** A process crash or an earlier failed source attempt can erase the useful output.

**Treat recovered bytes as a successful analysis.** File existence does not prove the requested computation completed.

## Consequences

Partial capture and live logs improve diagnosis without guaranteeing recovery of every output. Attempt retention and runtime output budgets remain bounded configuration; desktop diagnostics do not establish platform packaging acceptance.

## Related

Related owners: [science-auto-capture](../feature/2026-08-19-science-auto-capture.md); [provisioning-attempt-logs](2026-09-07-provisioning-attempt-logs.md).
