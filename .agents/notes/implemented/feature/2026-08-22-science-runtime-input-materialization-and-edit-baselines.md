# Agent Note: Science Runtime materializes artifact inputs and assigns edit baselines

Status: implemented

English | [中文](2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md)

## Problem

The Science Session schema records artifact ancestry and run dependencies, but the Runtime could not produce either relationship. A run could not consume an exact prior artifact version from private scratch, and auto-capture could not distinguish an ordinary new version from content derived from an explicit older or cross-artifact baseline.

The broader [artifact-domain and image-edit proposal](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.md) requires these operations before model-facing tools can expose image editing. The [Session schema decision](../architecture/2026-08-22-science-artifact-lineage-and-run-input-schema.md) remains the durable validation authority.

## Decision

`ScienceRuntime.startRun` accepts optional `artifactInputs` and `editBaselines`. Each input names one committed `{artifactId, version}` and one forward-slash relative path. Before `science/run-started`, the Runtime resolves every version from the live strict projection, reads its attachment through the provider's checksummed `readImage` or `readText` path, writes the verified bytes below the unpublished run's reserved `inputs/` directory, and records the complete ordered mapping on the start fact. The terminal fact repeats the mapping through `ScienceRunIdentity`.

Input paths reject empty, dot, parent, backslash, NUL, malformed-Unicode, duplicate, case-folded, normalization-equivalent, and file-versus-directory collisions. `inputMaxFilesPerRun` and `inputMaxBytesPerRun` apply to the complete requested input set before publication; the aggregate byte bound is checked against both durable attachment metadata and verified bytes. Missing versions reject with `INPUT_NOT_FOUND`, unsafe paths with `INPUT_PATH_INVALID`, and count or byte excess with `INPUT_TOO_LARGE`. Every rejection leaves no published run or retained unpublished run directory.

The reserved `inputs/` directory is a sibling of `artifacts/`, never a child of `SCIENCE_ARTIFACT_DIR`, so materialized evidence cannot be captured as new output. The persistent-kernel protocol remains version 1: the existing run cwd makes `inputs/...` directly readable without another frame field or kernel helper.

Each `editBaselines` key is a validated capture-relative output path and its value is one committed artifact version. The Runtime copies and validates the map before publication, then retains it until the post-terminal capture walk. A matching output carries that exact ref as `parent`; the output path still determines logical artifact identity and version advancement. An existing name advances its artifact, a new name creates a cross-artifact branch, and an older baseline stays visible as a stale branch. An unmatched output has no parent, and byte-identical output remains skipped. A missing baseline rejects with `ARTIFACT_NOT_FOUND`.

Captured images continue through the attachment provider's verbatim admission route. Input reads therefore recover the byte-exact evidence object that capture committed, while model-request image projection remains free to derive normalized route-specific bytes separately.

## Alternatives considered

**Pass attachment-store paths to the kernel.** Attachment ids are provider-independent references, not Host paths, and exposing provider storage would bypass verified reads and couple the Runtime to one backend.

**Place inputs inside `SCIENCE_ARTIFACT_DIR`.** The capture walk would treat consumed evidence as newly produced output, creating false versions and dependency cycles.

**Infer edit ancestry from output names or latest versions.** A renamed output may branch into a new artifact, and an edit may intentionally descend from an older version. Only the caller's exact baseline preserves those facts.

**Extend the kernel wire with input and baseline fields.** The Host already owns the run directory before `RUN` and the capture walk after `DONE`. Extending both kernel drivers would add protocol state without granting authority or behavior the Host lacks.

**Reuse auto-capture limits for inputs.** Capture limits govern best-effort produced output after terminal commit; input limits govern all-or-nothing pre-publication dependency materialization. They have different failure timing and deployment costs.

## Consequences

Runtime callers can execute against exact prior evidence and record the dependency in the Session log without exposing attachment storage or Host paths. Capture ancestry preserves existing-name edits, cross-artifact branches, and stale baselines without changing artifact version ordering.

The model-facing `run_python` and `run_r` schemas expose these fields through the [Science run-tool exact-version inputs](2026-08-22-science-run-tool-exact-version-inputs.md) decision. Materialized inputs remain retained with accepted run scratch under the existing retention policy.

## Testing

The `science-runtime` suites execute the real Runtime and local attachment provider against the fake kernel protocol. They cover exact-byte input placement, complete start/terminal mapping, exact and exceeded aggregate-byte bounds, unresolved versions, path escape and ancestor collisions, existing-name advancement, cross-artifact branching, and stale-baseline ancestry. Configuration tests pin both new bounds and their accepted extrema.
