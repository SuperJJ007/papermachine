# Agent Note: Science desktop product composition and provisioning

Status: proposed

English | [中文](2026-08-23-science-desktop-product.zh.md)

## Problem

The shipped Science capability is selectable as an agent preset inside the browser product, while the intended desktop product is a scientific workstation whose users should never choose a product mode. A new macOS user still needs Node, pnpm, a terminal command, a browser URL, manually prepared Conda prefixes, settings-file edits, and an environment variable before the first analysis. Those installation requirements make the existing feature composition unusable as a double-click product for researchers who do not administer programming environments.

The desktop carrier also crosses several existing ownership decisions. The Host must remain a separate process so its failures and process tree do not take down Electron. The Web Client packages must remain the single UI implementation, but the existing GUI architecture assigns HTTP and browser trust to the Web carrier and reserves an IPC fetch carrier for Electron. Credentials belong to the credentials provider, environment bindings belong to Science Runtime, durable sessions belong under the Harness home, and process cleanup belongs to the existing subprocess lifecycle. A shell that bypasses any of those owners would create a second product architecture.

Science and discipline are different composition axes. Science supplies the product workflow, UI, Runtime, and model-facing analysis capabilities. A discipline package supplies instructions, skills, output conventions, and an environment declaration. Treating Science itself as a selectable preset makes the product axis optional; treating a discipline as a product mode prevents a session from changing disciplines without changing the desktop product.

## Proposal

Ship a macOS-first Electron application whose product bundle always mounts the complete Science composition. The desktop application has no “Science mode” selector or session-header badge. Generic Harness deployments retain the existing `agentPreset === 'science'` presentation fence, while the desktop composition supplies the Science identity for every session. Discipline packages remain selectable agent compositions and may be changed independently of the product carrier.

Electron starts the built Host as a child process with `DSH_HOME` rooted at `app.getPath('userData')`. The Host and every kernel or tool subprocess inherit an explicit launch environment rather than the user's interactive shell. Normal application shutdown asks the Host to dispose its Cordis tree; unexpected Electron termination is covered by the existing subprocess process-tree cleanup and a desktop acceptance test that detects residual descendants. A Host crash leaves the Harness home intact and presents a restart action in the existing window.

The released application is intended to load the built Web Client from `file://` and use an Electron IPC implementation of the Client fetch carrier, serving the UI on no loopback port and exposing no browser URL. That IPC carrier is not implemented yet: every current build, packaged or not, launches the private-loopback Web carrier on an OS-assigned port. `main.ts`'s packaged branch selects the staged production Host closure but runs the identical `dsh --profile web` process over `127.0.0.1`, and Electron Builder packages that closure into the DMG (`apps/desktop/electron-builder.yml`'s `.stage/host` → `host` resource). The private-loopback Web carrier is therefore the transport for the packaged development carrier too, until the IPC carrier lands. This keeps the [GUI layering decision](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) authoritative for transport ownership, since the loopback launcher is a development bridge rather than a second transport implementation.

## Product composition

The desktop bundle's Runtime overlay (`apps/desktop/src/runtime-overlay.ts`) sets the `agent-presets` config `default` to `science` and disables `ui-agent-preset` (the generic preset-picker row), so a session created in a fresh Harness home mounts the shipped `science` preset with no visible mode selector. This settings-default mechanism is the accepted interim approach, not a rejected alternative: it reuses the existing preset-default seam instead of a new product-composition layer that inserts Science rows independent of preset selection. Its known limitation is that `AgentPresets.defaultId` reads a hot-reloaded user settings value before the config default (`packages/preset/agent-presets/src/index.ts:192`), so a settings value written after the overlay applies can still select a different preset for a later session, and the desktop composition does not otherwise prevent that. Direct Science-row insertion, independent of preset selection and immune to a settings override, remains the target once the packaged IPC carrier replaces the loopback development launcher. The preset mechanism remains the session-scoped discipline layer beneath it: a discipline composition contributes its persona, instructions, skills, and environment-package identifier. The first discipline package is social science; biology follows as the first large-environment validation.

Generic CLI and Web profiles keep their current composition and Science fence. The existing shipped `science` preset remains available there until discipline packages replace its remaining prompt and tool contribution. During that migration, the desktop bundle steers the same preset by its settings default rather than mounting duplicate registrations. This note partially supersedes the [Science preset note](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md)'s claim that Science is strictly an opt-in preset: that note remains authoritative for generic Web preset selection, roster, and durable Science identity, while the desktop composition makes `science` the default for its own product surface through the settings-default mechanism above.

## Provisioning

Each discipline package carries a versioned environment declaration naming supported platforms, a micromamba environment lock or explicit channels and packages, disk-space guidance, and health checks. The declaration contains no executable hooks. A desktop provisioning service validates the declaration, installs through the application-bundled micromamba executable into an application-owned environment directory, streams structured progress to the onboarding UI, and publishes an applied Science environment revision only after both interpreter health checks pass.

Provisioning is resumable and transactional at the declared environment revision. Each revision publishes to its own prefix path (`environments/<discipline>/<revision>`), and every health check runs against that exact path — Conda/micromamba installs bake the install-time prefix into shebangs and interpreter home variables, so a check that passed at one path proves nothing about a different published path. A failed or cancelled solve leaves the prior applied revision authoritative; retry reuses micromamba's package cache and clears the unready prefix directory before recreating it, since a prefix directory with no matching `applied.json` entry is never ready. Network channels and optional mirrors are validated configuration because reachability varies by deployment. The social-science declaration supplies Python with pandas, statsmodels, matplotlib, and Altair, plus R with base R and the initial tidyverse statistical packages. The biology declaration supplies the later Bioconductor validation set and raises the provisioning timeout and disk guidance through declaration fields rather than plugin constants.

A discipline is not fixed forever once applied: at startup, the applied revision is compared against the shipped declaration for the same discipline id, and a mismatch routes back to onboarding to re-provision the newer revision. Because each revision has its own prefix, re-provisioning never touches the currently applied prefix until the new revision itself is applied. An application-menu action reopens onboarding on request so a user can provision a different discipline package or the same one again.

The Runtime continues to own interpreter execution and revision rebinding. Provisioning only creates and verifies prefixes, then calls the Runtime-owned binding operation. The [persistent-kernel decision](../../implemented/architecture/2026-08-20-science-persistent-kernel.md) remains authoritative for ending a stale kernel after a newer applied environment revision.

## Onboarding and credentials

A fresh Harness home opens onboarding before the session workspace. The user selects a discipline package, reviews the required download size, and starts provisioning, with cancel and retry available while it runs. Desktop onboarding collects no DeepSeek API key: credential entry inside desktop onboarding remains future work. The existing Web Client model-configuration UI that the workspace already loads remains the only writer, through the credentials provider as `DEEPSEEK_API_KEY`; it never enters desktop settings, logs, renderer persistence, command arguments, or crash diagnostics. Skipping key configuration keeps the application usable and presents that same guidance when a session needs inference.

Readiness is decided by `applied.json` alone; desktop onboarding keeps no separate state file. A discipline counts as onboarded once its declared revision matches the applied pointer for that discipline id (see Provisioning above), not merely a dismissed window. A failed step presents the failing subject, a safe correction, retry, and access to diagnostics with secrets redacted. Reinstalling or upgrading the application reuses the Harness home and does not repeat provisioning when the declared revision and health checks still match.

## Distribution

The macOS application is built from built `lib/` and Web artifacts under plain Node semantics; source launchers and tsx are absent from the package. Electron Builder produces a DMG for both supported macOS architectures.

Update metadata is published to a static feed with artifact checksums. An update can replace application code and the bundled micromamba executable but never the Harness home or applied environments. Windows remains outside the first release and requires a separate distribution and process-tree acceptance decision.

## Delivery slices

D1 through D5 are implemented in `apps/desktop`. D1 delivered the Electron carrier, separate Host lifecycle, application-owned Harness home, development launch, crash restart, and residual-process tests. D2 delivered the bundled micromamba asset pipeline, declaration schema, social-science provisioning service, progress and retry UI, and Python/R health acceptance. D3 delivered onboarding (discipline selection and provisioning), the startup revision comparison and application-menu action for re-provisioning or changing discipline described under Provisioning above, and the settings-default Science composition described under Product composition above. Credential-provider key entry inside desktop onboarding remains future work, with the existing Web Client model-configuration UI staying the only `DEEPSEEK_API_KEY` writer in the interim. D4 delivered DMG packaging and update metadata. D5 delivered the biology declaration and its larger timeout, capacity, cancellation, and recovery behavior.

Each slice started from an implementation brief scoped to that slice and landed only with package tests, an assembled keyless snapshot where model or product output changed, and docs and Agent Note updates. Three items remain outstanding attended evidence — verification a person must run and record on real hardware, not unimplemented slices: a real micromamba provisioning run against network package sources, a real DMG install and first-run onboarding on a clean macOS account, and a packaged-preload smoke test confirming the preload loads under `sandbox: true` in a built, signed application. Downloads and real-provider checks remain explicit evidence rows and are never inferred from source tests.

## Alternatives considered

**Keep Science as a user-selected preset with no desktop-specific default.** This preserves the current browser mechanism but makes the desktop product's defining workflow optional and exposes an implementation choice to researchers.

**Load the Web carrier through a hidden loopback URL in production.** This is a useful development bridge, but it retains HTTP serving, browser trust, and a local port in a product that already has an IPC carrier extension point. It also contradicts the existing GUI transport ownership decision.

**Run the Host inside Electron's main process.** This reduces one process but couples Cordis, model, kernel, and Electron failures and prevents independent Host restart.

**Use Tauri.** Its smaller shell does not offset a second Rust/WebView toolchain and compatibility matrix for a Host and UI already implemented in Node and Web technologies.

**Install Python and R through user-managed Conda.** This preserves the current Runtime input but fails the zero-terminal and zero-Conda product acceptance and makes environment reproducibility depend on the host machine.

**Store the API key in desktop preferences.** That duplicates the credentials provider and creates another secret persistence path with different redaction and permission behavior.

## Acceptance criteria

- On a clean supported Mac, a user installs the DMG, completes onboarding, analyzes a local dataset with the social-science package, creates Python and R charts, and exports an artifact without using a terminal, Conda knowledge, or a browser URL.
- Every desktop session has the Science product composition while the selected discipline remains independently replaceable.
- A Host crash can be restarted without losing sessions; normal quit and forced-quit acceptance leave no Host, kernel, or tool descendants.
- Provisioning resumes or retries after network, disk, cancellation, and health-check failures without publishing a partial environment revision.
- The DeepSeek API key is stored only through the credentials provider and is absent from logs, settings, renderer storage, arguments, and packaged defaults.
- Packaged code uses built artifacts, the UI uses the Electron IPC carrier, and release evidence separately proves DMG installation, update-metadata verification, and clean-account behavior.
- The biology package provisions a usable Bioconductor baseline and exercises the documented large-environment capacity and timeout behavior.

## Risks

Electron and the scientific environments materially increase download and installed size. Environment declarations and onboarding must present honest disk and network estimates, and update code must not duplicate immutable caches without bounds.

Conda-forge and Bioconductor reachability varies by region. Mirror configuration can improve reachability, but accepting arbitrary channels expands the software-supply-chain trust decision and must remain explicit to the user.

Forced termination can bypass cooperative Cordis disposal. Process-group behavior differs by platform, so macOS acceptance must observe actual descendants rather than infer cleanup from the Electron or Host exit code.

The transition from the shipped Science preset to desktop-owned rows can create duplicate tool and projection registrations. The desktop bundle must prove its full composition and the generic Web profile separately, and no shared package may infer the desktop carrier from process globals.
