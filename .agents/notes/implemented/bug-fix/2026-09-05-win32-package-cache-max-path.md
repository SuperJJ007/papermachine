# Agent Note: The Windows micromamba package cache stays under MAX_PATH

Status: implemented

English | [中文](2026-09-05-win32-package-cache-max-path.zh.md)

## Problem

Windows package-cache paths include both the configured cache root and long package-internal paths. A writable product home alone does not prevent MAX_PATH failures.

## Decision

Windows provisioning uses the short `<SystemDrive>\pm\pkgs` package-cache root selected by `resolvePackageCacheDir`. The product environment and package cache have different placement needs; moving the user’s home does not shorten every extracted package path. Path calculations use Windows path semantics even when inspected by tests on another host.

## Alternatives considered

**Keep the cache under a deeply nested user home.** Long archive members can exhaust the remaining path budget.

**Assume enabling long paths fixes every extractor.** Every participating executable must support that behavior.

**Keep shortening the root indefinitely.** Mirror hostnames and future package members also consume the budget; a few saved characters are not a durable guarantee.

## Consequences

The short root reduces risk without guaranteeing all packages fit. Mirror choice has its own measured failure and reintroduction conditions. Current source retention does not claim Windows installation acceptance; cache sharing, permissions, and actual packaged executables still require platform verification.

## Related

Related owners: [win32-package-cache-tuna-max-path](2026-09-07-win32-package-cache-tuna-max-path.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.md).
