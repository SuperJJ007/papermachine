# Agent Note: Recoverable raster declarations and Desktop Host diagnostics

Status: implemented

English | [中文](2026-09-02-raster-capture-recovery-and-host-diagnostics.zh.md)

## Problem

The default declared-raster policy deliberately leaves a PNG uncaptured when its writing run omits the path from `raster_artifacts`, but the model-visible result only named the omission. A later `annotate_artifact` call reported an unknown artifact even when the file remained in retained run output. Neither response explained the executable recovery, so a model could repeat annotation without ever registering the PNG.

Desktop discarded Host stderr after launch. Capture, chart-extraction, provider, and boot diagnostics were consequently unavailable after a failure, while persisting raw stderr without bounds or redaction could disclose credentials and grow without limit.

## Decision

### Recover an undeclared raster by rerunning its producer

This extends the [`rasterCapture: 'declared'` policy](../feature/2026-08-27-artifact-identity-stability-and-raster-capture-policy.md) without changing its default. Each `run_python` or `run_r` receives a new private artifact directory, so a later empty run cannot see or capture an earlier run's PNG. A skipped-raster result now names the matching language tool, the exact `raster_artifacts` array, and the requirement to rerun code that writes the file.

When `annotateArtifact` cannot resolve a logical name from the session projection, it checks the newest `annotateDiagnosticMaxRuns` retained runs (a validated `Config` field, default 20, from 1 through 1,000) with the capture walk's existing safe-path rules, in two locations per run: first the run's own `SCIENCE_ARTIFACT_DIR` (an undeclared PNG under the `'declared'` policy), then — only when that finds nothing — the run's own scratch root, matched by exact relative path so a same-named file already nested inside the reserved `artifacts/` or `inputs/` subdirectories never counts twice (a PNG the writing code never routed under `SCIENCE_ARTIFACT_DIR` at all, so no capture policy ever had a chance to admit it). Finding an eligible PNG in either location changes only the `ARTIFACT_NOT_FOUND` message: it directs the caller to rerun the writing code with the path declared, writing under `SCIENCE_ARTIFACT_DIR` when the PNG was found at the run's scratch root, then annotate again. This diagnostic reads path metadata only. It never reads or imports the file bytes, mutates the project artifact store, or changes annotation's metadata-only meaning. A failed scratch-plan read for one run is skipped rather than aborting the walk; the run-root and artifact-dir directory listings this diagnostic itself performs cannot fail (a bounded, symlink-rejecting walk that already reports its own read failures as an empty result), so a fully unavailable diagnostic falls back to the ordinary unknown-artifact error only when the session's scratch root itself cannot be planned.

### Persist bounded, redacted Desktop Host stderr

The Electron carrier writes Host stderr to `<dshHome>/logs/host.log` through a serialized rotating writer. `resources/host.json` is a strict, versioned config with validated `logMaxBytes` and `logMaxRotatedFiles` fields; the shipped values keep a 5 MiB active file plus two numbered rotations. The directory and files are private, symlinks and non-regular files are rejected, complete lines are redacted before disk writes, and a line larger than the active-file bound becomes a fixed omission marker. Redaction covers exact values from credential-named Host environment variables and common bearer, API-key, authorization, credential, password, secret, token, and `sk-…` forms.

The log remains an operator diagnostic, not an application protocol or renderer input. Startup and port fallback still use the readiness line and exit state; free-form stderr never changes launch decisions.

## Alternatives considered

**Capture an earlier run's PNG from an empty follow-up run.** Rejected because per-run artifact directories intentionally isolate output ownership. Reusing an older directory would weaken that ownership and attribute bytes the registering run did not produce.

**Import the file from `annotate_artifact`.** Rejected because annotation curates a committed version's metadata. Secretly adding a content version would combine production and curation under one tool call and obscure producer provenance.

**Change the Desktop overlay to `rasterCapture: 'always'`.** Deferred for user decision. It removes reliance on model declarations, but also admits self-inspection and debug renders into the project library. Keeping `'declared'` preserves the existing noise-control policy while the new result and annotation diagnostics make recovery executable.

**Persist raw stderr or only Science-prefixed lines.** Raw output is unsafe and unbounded; a Science-only filter would omit boot and provider failures needed to diagnose why the Host never became ready. Bounded redaction preserves cross-subsystem diagnostics without exposing known credential forms.

## Consequences

An undeclared PNG remains absent from the artifact store until a new run actually writes and declares it. Both immediate run output and a later annotation attempt now tell the model how to perform that run, and the keyless Science snapshot records the recovery text. No session event, SDK field, chart-capture discriminator, or UI state changes. `annotateDiagnosticMaxRuns` bounds the diagnostic's own per-run directory walk inside the runtime lease, documented in `dsh-science-runtime`'s README and `docs/config-catalog.md`, matching every other deployment-varying Science Runtime bound.

Desktop failures leave a bounded diagnostic trail under the Harness home. Rotation and redaction are deterministic and tested, but redaction cannot prove that every possible secret format is known; Host components must still avoid printing credentials. A missing or invalid shipped Host config fails launch rather than silently disabling the bound.

The supersession audit found one stale statement in [Desktop Host launches on its last bound port](2026-09-01-desktop-host-port-persistence.md): stderr is now retained for diagnosis. That note remains active because its port and readiness decisions still apply, and its statement is updated to link here. The prior raster-policy note likewise remains the authority for why declared capture is the default; this note adds recovery behavior without replacing it.
