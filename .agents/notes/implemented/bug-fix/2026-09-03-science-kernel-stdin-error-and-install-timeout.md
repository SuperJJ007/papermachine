# Agent Note: kernel stdin EPIPE handling and honest install-timeout reporting

Status: implemented

English | [中文](2026-09-03-science-kernel-stdin-error-and-install-timeout.zh.md)

## Problem

An asynchronous stdin EPIPE can crash the Host without a stream listener. Package installation can also finish successfully during timeout grace or change packages without changing interpreter identity.

## Decision

KernelProcess retains a stdin error listener for the kernel lifetime. Errors on a live stream enter protocol failure; errors after settled exit cannot become uncaught Host exceptions. Synchronous write catches do not own asynchronous stream errors.

Installation uses validated `installTimeoutMs`, independently of ordinary call timeout. Signal-free exit-zero completion takes precedence over a previously latched timeout cause. Re-observation compares identity and `packagesSha256`; an unchanged result retains the revision and reports `environmentChanged: false`. A genuine timeout warns that the prefix may already be written.

## Alternatives considered

**Wrap every write in try/catch.** Broken-pipe errors can arrive through the later error event.

**Classify only from the control’s timeout cause.** This misreports a successful grace-window exit.

**Use bindingFingerprint alone for no-op detection.** Identity deliberately excludes the package hash.

**Hardcode a longer install constant.** Deployment-varying timeouts belong in validated configuration.

## Consequences

No-op installation must not restart a healthy kernel. A timeout is not rollback; verification precedes a bounded retry. Historical fixture coverage does not prove every catalog consumer: the source record named a missing dedicated API-catalog test, which remains a verification requirement when that consumer is changed.

## Related

Related owners: [science-package-install](../feature/2026-09-01-science-package-install.md).
