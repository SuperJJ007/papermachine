# Agent Note: Fork integration workflow ownership

Status: implemented

English | [中文](2026-09-11-fork-integration-workflow-ownership.zh.md)

## Problem

PaperMachine pull requests inherit jobs that create an App token for the upstream project board and deploy previews to its Cloudflare project. Remote qualification fails before policy validation because the upstream App client ID is absent. Fork pull requests must not implicitly deploy to infrastructure they do not own.

## Decision

The [issue policy](../../../../.github/workflows/issue-policy.yml), [issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml), and [preview](../../../../.github/workflows/build-preview-cloudflare.yml) jobs require `github.repository == 'deepseek-harness/deepseek-harness'`, matching the App target. Forks skip them before checkout, token creation, or deployment. Existing event conditions remain effective in the owning repository.

The [fork runner decision](2026-09-10-papermachine-fork-hosted-ci.md) continues to own test capacity and required checks. Product CI, real-API tests, native builds, and credential-free release packing retain their existing conditions.

## Alternatives considered

**Copy credentials or retarget integrations implicitly.** PaperMachine has no configured equivalent App or protected preview project; credentials alone do not establish target ownership.

**Cancel previews manually and accept policy failures.** Cancellation cannot protect later pushes, and unrelated credential failures obscure qualification results.

## Consequences

These jobs report skipped, not passed product checks. A future PaperMachine integration needs its own verified target and authorization. Workflow specifications reject missing or changed ownership predicates while retaining assertions on event, token, and deployment settings. Existing upstream policy and fork runner notes retain their independent rationale; no archived record changes.
