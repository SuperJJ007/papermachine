# Agent Note: TUNA is deterministically over MAX_PATH under the win32 package cache; USTC is the default instead

Status: implemented

English | [中文](2026-09-07-win32-package-cache-tuna-max-path.zh.md)

## Problem

A short Windows cache root still leaves little margin when micromamba includes a long mirror hostname in a package path.

## Decision

The cache root remains `<SystemDrive>\pm\pkgs`; product source order and the China-locale default prefer USTC. Historical extraction measurements found a 252-character USTC path and a 261-character TUNA path for the same package at that root. Dropping one root segment would leave only about two characters of TUNA margin and abandon existing cached downloads. TUNA remains a selectable source, not a promised fix for the underlying path limit. Download-size estimates must reflect the real declared package set rather than a smaller historical guess.

## Alternatives considered

**Enable mirrored_channels immediately.** The investigation observed an apparent hang when the first mirror failed; dependable file-level failover needs real-hardware diagnosis before becoming a provisioning dependency.

**Hard-link downloads into another mirror’s expected cache layout.** This depends on undocumented micromamba internals and should be reconsidered only after supported mirror failover is understood.

**Shorten the root again.** The tiny margin does not survive longer future package members and forces cache re-downloads.

## Consequences

The source preference reduces a known failure without guaranteeing all future archive paths fit. Historical USTC installation success is not current platform acceptance. Reintroducing file-level mirroring requires bounded failure/failover evidence against the packaged micromamba version.

## Related

Related owners: [win32-package-cache-max-path](2026-09-05-win32-package-cache-max-path.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.md).
