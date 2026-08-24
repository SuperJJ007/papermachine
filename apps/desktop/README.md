# dsh-desktop

English | [中文](README.zh.md)

`@deepseek-ai/dsh-desktop` is the macOS-first Electron carrier for the Science desktop product. It starts the existing Web profile as a separate Host process, assigns the Electron `userData` directory as `DSH_HOME`, and loads the Host's OS-assigned loopback URL inside a locked-down BrowserWindow.

A fresh home opens the desktop-owned setup page before the workspace. The user chooses the social-science or biology package, sees its declared download and disk requirements, and can cancel or retry while micromamba streams progress. The provisioner validates both Python and R before atomically publishing the prefix. The generated Host overlay binds that prefix to the fixed `science` Runtime profile, makes Science the session default, and removes the generic product-mode picker. The following existing Models onboarding remains the only API-key writer, through the credentials service.

## Development

Build the repository Web artifacts first, then run:

```sh
pnpm --filter @deepseek-ai/dsh-desktop dev
```

Development requires the pinned micromamba asset for the current machine:

```sh
pnpm --filter @deepseek-ai/dsh-desktop fetch:micromamba darwin-arm64
```

Use `darwin-x64` on an Intel Mac. The download is accepted only when its SHA-256 digest matches `resources/micromamba.json`.

The carrier never opens the system browser. External HTTPS links are handed to the operating system, while every other navigation outside the active Host origin is refused. An unexpected Host exit leaves the Harness home intact and replaces the page with a restart action.

## Process lifecycle

The Host owns its own POSIX process group. Normal Electron shutdown sends `SIGTERM` so the Host can dispose Cordis and its subprocess tree, then escalates to `SIGKILL` after a bounded grace period. A sibling plain-Node watchdog observes Electron and stops the Host group if Electron is forcibly terminated.

## Environment declarations

`resources/environments/*.json` is a closed, data-only format: schema version, discipline id and revision, supported macOS architectures, channels and packages, honest capacity fields, an operation timeout, and exactly one Python plus one R health check. It admits no executable installation hook. Each revision installs directly at the prefix path it publishes under (`environments/<discipline>/<revision>`), so every health check runs against the exact path `applied.json` will point to — Conda/micromamba installs are not relocatable, so verifying one path and publishing another would prove nothing about what ships. A failed solve, cancellation, or health check leaves the previous `applied.json` pointer unchanged for a fresh or different-revision provision; the same-revision repair path clears that pointer before touching the prefix (see below), so a failure there leaves no applied revision at all. Retry reuses micromamba's package cache and clears the unready prefix directory before recreating it, since a prefix with no matching `applied.json` entry is never ready.

The social-science declaration includes pandas, statsmodels, matplotlib, Altair, tidyverse, broom, and modelr. The larger biology declaration adds Scanpy, Biobase, DESeq2, and GenomicRanges and carries its own larger timeout and disk requirement.

Choosing a discipline is not permanent. At startup, the applied revision is compared against the shipped declaration for the same discipline id; a mismatch routes back to onboarding to re-provision. Provisioning a different revision leaves the currently applied environment untouched and usable until the new revision is itself applied. Re-provisioning the exact revision already applied instead repairs it in place, clearing the applied pointer before deleting and recreating the prefix so a failure leaves an honest not-ready status rather than a destroyed environment still marked current. The application menu also offers a "Change Discipline…" action that stops the active Host, then reopens onboarding on request.

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` builds the repository, downloads both pinned micromamba architectures, stages a symlink-free production Host closure, and asks Electron Builder for arm64 and x64 DMGs. The generated app owns its Host, environment declarations, and micromamba executable; the Harness home and applied environments stay in Electron `userData` outside the application payload.

## Limitations

The UI still uses the Web HTTP carrier on private loopback. The packaged `file://` plus Electron IPC carrier, automatic update application, and Windows support remain outside this implementation. See the [desktop product decision](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.md).
