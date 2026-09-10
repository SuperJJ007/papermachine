# Agent Note: Serialize project identity resolution across processes

Status: implemented

English | [中文](2026-09-09-project-identity-locking.zh.md)

## Problem

Concurrent opens can read an absent workspace marker and allocate different project ids for the same directory. Concurrent metadata replacements can also fail with Windows `EPERM`, before SQLite can serialize artifact appends. Atomic replacement alone does not serialize a read-decide-write operation.

## Decision

Project identity resolution holds the workspace marker's cross-process writer lock before reading it. An existing marker additionally requires the project record's writer lock before reading the recorded path and deciding reopen, move, or copy. The order is always workspace then project; inspecting another workspace's marker never acquires its lock. New project ids have private store directories.

## Alternatives considered

Retrying failed renames cannot prevent duplicate identities or competing move decisions. A process-local mutex cannot coordinate separate Hosts. A global registry lock would serialize unrelated workspaces. The existing atomic-write lock supplies bounded contention and fail-loud orphan handling without a second lock implementation.

## Consequences

Concurrent first opens share one identity, and multiple surviving copies of a removed workspace cannot all claim its moved identity. The marker and store record remain separate atomic files, so this does not promise crash-atomic publication across both. SQLite continues to own artifact-version ordering under the [project-store decision](../architecture/2026-08-26-project-artifact-store-s1.md); metadata locking supplements that mechanism.

## Verification

Concurrent first-open and move/copy regressions verify identity ownership. Real OS processes reopen and append to one store. The runnable Science snapshot opens its workspace concurrently before producing artifacts and verifies one project identity alongside cold history.

## Related

Related owners: [project-artifact-store](../architecture/2026-08-25-project-artifact-store.md); [project-artifact-store-s1](../architecture/2026-08-26-project-artifact-store-s1.md).
