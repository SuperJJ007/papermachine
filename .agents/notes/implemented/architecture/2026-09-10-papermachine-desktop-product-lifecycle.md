# Agent Note: PaperMachine desktop product lifecycle

Status: implemented

English | [中文](2026-09-10-papermachine-desktop-product-lifecycle.zh.md)

## Problem

PaperMachine must provision scientific interpreters and recover user-selected installation locations without giving application content package-management or filesystem authority. Environment installation and the existing journaled desktop package installer both stop and restart a Host using the same product home; independent operation lifetimes permit one operation to restart the Host while another changes its environment or application profile.

## Decision

Keep the framed-pipe Host, stable `dsh-app://app` origin, installed Science bundle, and staging/rollback project manager. Add shell-owned onboarding and recovery pages with separate sandboxed preloads. Every setup or recovery request verifies the exact owning window, its main frame, and its shell page. Application content receives only the carrier marker.

Resolve the product home before browser data, the single-instance lock, profile paths, and seed extraction. Desktop adds R's canonical-path space restriction to the shared resolver; it does not change CLI path policy or import official DSH state. A location change requires confirmation, leaves existing files untouched, saves the pointer, and restarts. The first-run window appears before the user starts seed installation and Conda provisioning.

One desktop operation owns installation, environment changes, plugin mutations, and home changes until its asynchronous work settles. Shutdown refuses new work, aborts the environment child, waits for an active package transaction, then stops the Host. Health probes and active Host starts regenerate machine-specific Science configuration. Plugin staging preserves the profile overlay. Reconciliation compares the whole local package set and every installed package version, so missing client packages and changed same-version package artifacts trigger repair.

The product version is independent of internal harness package versions. About, onboarding, and artifact names read the same product version JSON; internal package and seed verification remain exact. A POSIX Host owns a process group and a bundled-Node watchdog. Orderly shutdown waits for descendants and the watchdog; parent death triggers group collection. The watchdog does not unlink the package transaction lock, whose pnpm-worker ownership remains authoritative. Host stderr is bounded, redacted before persistence, and rotated using packaged configuration.

The development and packaging entrypoints share a resource preparer. It reuses SHA-256-verified executable caches or downloads the pinned official asset, and exposes no caller-supplied download URL. Product resources include the environment declarations and skills; Windows resources also include the pinned app-local runtime. Telemetry configuration ships without main-process event delivery.

Desktop requires the explicit `papermachine` client build profile. The build record binds its title and profile to the commit, internal package version and complete client artifact digest. Both development and packaging verify that record; skipped builds cannot consume official artifacts whose PaperMachine registration was removed by constant folding. Desktop packs its local seed inputs through shared tarball validation without producing an npm publish-order manifest. Official release packing continues to require the exact official profile.

Seed preparation boots each offline-installed Host composition with the bundled Node.js in a disposable home and requires the matching release before archiving its store. Package-file checks alone cannot establish runtime readiness: pnpm may skip a failed optional native download while reporting installation success. The probe awaits Host shutdown and removes its home on both success and failure.

## Alternatives considered

Replacing the upstream shell with the earlier HTTP launcher would discard stable-origin client state and transactional package upgrades. Installing Science as an ordinary user plugin would make the product removable. Giving onboarding the plugin-manager preload would widen renderer authority beyond environment setup. Reusing one release number as the sole repair predicate misses changes to the client package closure at the same internal release.

## Consequences

Development projects link the built workspace and skip seed application. Their runtime/UI results do not establish seed or installed-profile qualification. The macOS seed preparer requires Developer ID signing and has no supported unsigned preparation mode, including when packaging stops after preparation.

Session files stay under the shared product home and are never rewritten by desktop setup, heal, or location selection. Persistence readers own compatibility decisions. Environment declarations, binding checks, cancellation, source fallback, custom package validation, and staged overlay tests own non-Session setup behavior; main-entry tests verify window order, IPC rejection, retry, recovery, and quit races. Watchdog process tests use the actual source entry with tsx's ESM hook and awaited process cleanup.

The existing [Electron packaging/update note](2026-08-25-electron-desktop-packaging-and-updates.md) retains authority for byte transport, signed seed verification, rollback, and package isolation. The [installation-isolation note](2026-09-10-papermachine-installation-isolation.md) retains the shared home resolver and official DSH separation. This note adds the desktop-specific R constraint and environment lifecycle rather than replacing those decisions. Platform signing, installer matrices, and live product acceptance require separate evidence.
