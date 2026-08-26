# dsh-desktop

English | [中文](README.zh.md)

`@deepseek-ai/dsh-desktop` is the macOS-first Electron carrier for the Science desktop product. It starts the existing Web profile as a separate Host process, assigns `~/.papermachine` as the Harness home (`DSH_HOME`), and loads the Host's OS-assigned loopback URL inside a locked-down BrowserWindow. The Harness home is resolved by `src/harness-home.ts` under the OS user home directory, deliberately independent of Electron's own `userData` directory (which keeps holding only Electron's cookies, caches, and similar state): R refuses to run with an ASCII space anywhere in its scratch `TMPDIR`, and macOS's `userData` path (`~/Library/Application Support/PaperMachine`) contains one, so resolution fails loud instead if the OS user home itself has a space in its path.

A fresh home opens desktop onboarding before the workspace. Onboarding scans this machine's conventional Anaconda/Miniconda/Miniforge/Mambaforge/Micromamba install locations and `~/.conda/environments.txt` for qualifying conda-family environments, without invoking a terminal or any conda command, and lets the user bind a Python and an R environment independently — no download runs. Binding re-validates each chosen prefix for its own interpreter, writes `<dshHome>/environment-binding.json`, and opens the workspace; the generated Host overlay binds the named prefix(es) to the fixed `science` Runtime profile, makes Science the session default, removes the generic product-mode picker, and disables the shared module-reload `hmr` row. The following existing Models onboarding remains the only API-key writer, through the credentials service. See "Onboarding and environment binding" below.

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

## Onboarding and environment binding

Startup routes solely on `<dshHome>/environment-binding.json` (`src/environment-binding.ts`): a missing file is an ordinary first run that opens onboarding, a file that fails to parse or names a prefix that has since disappeared also routes to onboarding but with a loud status message, and a valid binding opens the workspace directly. The discipline-package `applied.json` pointer described under Environment declarations below plays no role in this routing.

Detection (`src/detection.ts`) qualifies a prefix by a regular, non-symlinked `conda-meta/history` file plus at least one of `bin/python` or `bin/Rscript` — the same POSIX layout Science Runtime's own interpreter check requires — and shows qualifying candidates with best-effort interpreter versions from a scrubbed, timeout-bounded `--version` probe. A failure scanning one root or qualifying one candidate (an unreadable directory, a symlink loop, a root that turns out to be a plain file) drops only that root or candidate; detection itself never fails for a filesystem condition. Onboarding lists candidates in two independent, single-select groups — Python environments and R environments, each with an explicit "None" option — because on a real machine Python and R commonly live in separate conda-family environments, and `environment-binding.json`'s `pythonPrefix`/`rPrefix` are independent fields; a candidate with both interpreters appears in both groups. Each group preselects its first qualifying candidate. Binding re-validates each chosen prefix against the specific interpreter its group selected it for (`resolveBindRequest` in `src/environment-binding.ts`), since the filesystem can change between detection and the click; a re-check failure on either chosen prefix rejects the whole bind rather than persisting a partial result. When no candidate qualifies at all, onboarding shows install guidance (install Anaconda, then re-detect) in place of a candidate list. The application menu's "Rebind Environment…" action stops the active Host, then reopens onboarding so the user can bind different environments.

## Environment declarations

`resources/environments/*.json` is a closed, data-only format: schema version, discipline id and revision, supported macOS architectures, channels and packages, honest capacity fields, an operation timeout, and exactly one Python plus one R health check. It admits no executable installation hook. Each revision installs directly at the prefix path it publishes under (`environments/<discipline>/<revision>`), so every health check runs against the exact path `applied.json` will point to — Conda/micromamba installs are not relocatable, so verifying one path and publishing another would prove nothing about what ships. A failed solve, cancellation, or health check leaves the previous `applied.json` pointer unchanged for a fresh or different-revision provision; the same-revision repair path clears that pointer before touching the prefix (see below), so a failure there leaves no applied revision at all. Retry reuses micromamba's package cache and clears the unready prefix directory before recreating it, since a prefix with no matching `applied.json` entry is never ready.

The social-science declaration includes pandas, statsmodels, matplotlib, Altair, tidyverse, broom, and modelr. The larger biology declaration adds Scanpy, Biobase, DESeq2, and GenomicRanges and carries its own larger timeout and disk requirement.

This declaration schema, the transactional prefix installation above, its health checks, and the resumable same-revision repair path (re-provisioning the exact applied revision clears the applied pointer before deleting and recreating the prefix, so a failure leaves an honest not-ready status rather than a destroyed environment still marked current) remain fully implemented and tested, but have no onboarding entry point in this version — onboarding instead detects and binds an existing environment (see Onboarding and environment binding above). This path is retained as the planned install fallback for a machine with no usable conda-family environment.

## DMG

`pnpm --filter @deepseek-ai/dsh-desktop package:mac` builds the repository, downloads both pinned micromamba architectures, stages a symlink-free production Host closure, and asks Electron Builder for arm64 and x64 DMGs. The generated app owns its Host, environment declarations, and micromamba executable; the Harness home and applied environments stay under `~/.papermachine`, outside the application payload and outside Electron `userData`.

## Limitations

The UI still uses the Web HTTP carrier on private loopback. The packaged `file://` plus Electron IPC carrier, automatic update application, and Windows support remain outside this implementation. See the [desktop product decision](../../.agents/notes/proposed/architecture/2026-08-23-science-desktop-product.md).
