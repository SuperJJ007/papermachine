# Agent Note: kernel-scoped user-install bases make inline `pip install`/`install.packages()` actually work

Status: implemented

English | [中文](2026-08-22-science-kernel-scoped-inline-installs.zh.md)

## Problem

Inline pip and R installs need a writable library without mutating the shared bound prefix or leaking packages into a later kernel epoch.

## Decision

Kernel scratch owns Python `PYTHONUSERBASE` and R `R_LIBS_USER`; the R library directory is created before startup. Python kernels permit the user site while environment probes retain isolated startup. The driver creates the nested user-site directory and invokes `site.addsitedir(site.getusersitepackages())` when user-site loading is enabled: creating only the parent after Python site initialization does not add the eventual leaf to `sys.path`.

These libraries belong to the kernel epoch. Durable package installation remains a separate micromamba operation against the bound prefix.

## Alternatives considered

**Install inline packages into the shared prefix.** This changes other sessions without recording the requested durable mutation.

**Keep the scratch library for the whole session.** A rebind could import packages installed for a different interpreter.

**Set PYTHONUSERBASE alone.** The versioned site-packages directory may not exist when Python first builds its import path.

## Consequences

Inline packages disappear on kernel replacement and are not part of the environment lock or package digest. Probes stay isolated so kernel-local packages cannot make an otherwise invalid profile appear healthy.

## Related

Related owners: [science-persistent-kernel](2026-08-20-science-persistent-kernel.md); [science-package-install](../feature/2026-09-01-science-package-install.md).
