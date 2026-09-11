# Agent Note: atomic Science scratch owner publication

Status: implemented

English | [中文](2026-09-11-atomic-science-owner-publication.zh.md)

## Problem

Two exact-Session materializations can race to create the same scratch owner marker. Exclusive file creation reserves the name before writing its contents. A competing operation can therefore observe an empty marker and reject the correct Session identity while the winning writer is still writing.

## Decision

The scratch owner writes and synchronizes a unique mode-0600 temporary file in the marker directory, then publishes its complete contents with an exclusive hard link. Only the successful publication receives rollback ownership. A competing publication verifies the existing complete marker against the exact Session identity. The parent directory is synchronized after publication, and the temporary name is removed on success or failure.

The marker format and retained scratch layout are unchanged. Existing partial or mismatched markers remain errors; this change prevents new partial publication rather than treating corrupt identity evidence as reusable.

## Alternatives considered

**Retry reads of an empty marker.** This cannot distinguish an active writer from a crashed writer, and introduces a timing assumption at the identity boundary.

**Rename over the marker.** Replacement would overwrite a concurrent owner's evidence instead of preserving exclusive ownership.

**Serialize within one process.** Independent Host processes still share the filesystem namespace.

## Consequences

Readers see complete owner bytes and rollback remains exclusive. Publication needs hard-link support in the Harness home filesystem and fails closed if it is unavailable. A crash before temporary-name cleanup may leave a private temporary file; it is never accepted as an owner marker.

A barrier-controlled regression pauses the first writer before its contents exist, verifies that the formal marker is absent, lets the second writer publish, and confirms that the first writer reuses that complete marker without gaining rollback ownership.
