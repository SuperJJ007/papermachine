# Agent Note: Pre-existing defects blocked every win32 Science kernel before it could spawn

Status: implemented

English | [中文](2026-09-06-win32-scratch-privacy-and-probe-ordering.zh.md)

## Problem

POSIX mode bits and directory fsync do not establish Windows scratch privacy, and an ACL provider cannot confine a directory that has not yet been created.

## Decision

Scratch checks retain file kind and symlink validation on Windows while relying on inherited user-profile ACLs and sandbox policy for privacy. Directory-entry fsync is not promised there. Probe directories are created before confinement on every platform, and confinement failure follows the same cleanup and owned-session rollback path. The configured minimum enforcement reaches both persistent and isolated kernel creation.

Interpreter discovery uses platform layouts and, for PATH fallback, the nearest ancestor carrying Conda history rather than a fixed directory depth. Drivers write capture bytes without CRLF translation: Python controls both raw descriptor and text-wrapper behavior, while R uses binary capture connections. Fake process wrappers must follow current subprocess signal ownership and not duplicate provider tree delivery.

## Alternatives considered

**Keep POSIX permission checks on synthetic Windows mode bits.** They neither observe ACL privacy nor identify an actual unsafe directory.

**Reorder probes only on Windows.** Existence before confinement is a shared lifecycle requirement.

**Infer the Conda root with a fixed number of parent traversals.** R executable depth differs between builds.

**Accept platform newline differences.** Capture bytes enter the logged model input, so this is not merely terminal cosmetics.

## Consequences

Scratch directory-entry durability is weaker on Windows; session-log durability is a separate mechanism. POSIX chmod-based failure fixtures do not prove Windows ACL behavior. Platform verification must include actual ACL cleanup, interpreter discovery, and byte fidelity; portable fixture changes do not establish those results.

## Related

Related owners: [science-runtime-minimum-sandbox-enforcement](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.md); [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md).
