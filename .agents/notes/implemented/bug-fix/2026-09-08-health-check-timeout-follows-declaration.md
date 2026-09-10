# Agent Note: environment health checks use the declaration's own timeout instead of a hidden 120-second cap

Status: implemented

English | [中文](2026-09-08-health-check-timeout-follows-declaration.zh.md)

## Problem

A healthy freshly provisioned environment can need more than a fixed two-minute health-check cap, especially during cold native-library loading or binary translation.

## Decision

Health checks use the same `declaration.timeoutMs` as environment creation. Cancellation remains available independently of that deadline. The declaration therefore expresses the actual maximum for both stages instead of silently truncating one stage. Historical Rosetta measurements of the same Python health command took roughly 230 seconds cold and two seconds warm; those observations explain the rejected cap, not a current performance promise.

## Alternatives considered

**Introduce a new required healthCheckTimeoutMs field.** This changes every persisted declaration for a bound the existing field can express.

**Choose a larger fixed constant.** Another hidden cap still cannot fit deployment-specific cold-start cost.

## Consequences

Slow valid health checks can finish within the declared budget. Timeout still bounds a hung process, and user cancellation need not wait for it. Current code must pass the declared value to both creation and health checks; historical device timing is not evidence that current packages have passed platform acceptance.

## Related

Related owners: [desktop-general-environment](../feature/2026-09-01-desktop-general-environment.md); [provisioning-attempt-logs](2026-09-07-provisioning-attempt-logs.md).
