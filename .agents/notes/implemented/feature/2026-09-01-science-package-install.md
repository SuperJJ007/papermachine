# Agent Note: Science package installs through ordered micromamba channels

Status: implemented

English | [中文](2026-09-01-science-package-install.zh.md)

## Problem

Kernel-local installs disappear with the epoch, while durable package installation must use sources reachable from the deployment and record what changed.

## Decision

`install_science_packages` delegates to Runtime micromamba installation against the bound prefix. Ordered configured channels match product source policy; each attempt uses its selected source and the overall operation remains bounded by the installation budget. A successful installation is re-observed before reporting the applied environment. Identity fingerprint and package digest jointly distinguish a changed environment from a no-op.

No-op success retains the current revision and does not restart kernels. A changed environment records a new observation and takes effect through rebinding. Timeout guidance acknowledges that package writes may already be partial or complete and asks the model to check state or import before at most one retry.

## Alternatives considered

**Use pip or install.packages for the durable tool.** They bypass the declared Conda source and environment-observation path; epoch-local installs remain a different facility.

**Pin every install to conda-forge’s public hostname.** Provisioning could succeed through a mirror while later installs fail on the same machine.

**Append a revision after every exit-zero attempt.** A redundant install would restart a healthy kernel without changing packages.

## Consequences

Micromamba mutates a prefix shared by sessions. Other sessions detect Conda-history drift on their next run, not through an immediate broadcast. The tool has no added approval gate. An interrupted install is not an atomic rollback, and package inventory does not promise reproducible external pip mutations.

## Related

Related owners: [science-kernel-stdin-error-and-install-timeout](../bug-fix/2026-09-03-science-kernel-stdin-error-and-install-timeout.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.md); [desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.md).
