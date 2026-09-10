# Agent Note: PaperMachine fork CI on standard hosted runners

Status: implemented

English | [中文](2026-09-10-papermachine-fork-hosted-ci.zh.md)

## Problem

The upstream CI runner pools and standby machines are unavailable to PaperMachine. Carrying their selectors into the fork can leave required checks queued indefinitely, while their concurrency budgets assume more capacity than standard hosted runners provide. Science also requires real Python/R checks, and the telemetry receiver suites use Node's test runner rather than Vitest.

## Decision

[Pull-request CI](../../../../.github/workflows/ci.yml) and [post-merge CI](../../../../.github/workflows/ci-master.yml) use standard GitHub-hosted runners. Linux static, coverage, and artifact jobs have bounded concurrency; Windows jobs use native PowerShell. Enterprise failover selectors, persistent-runner setup, standby drills, and large-runner capacity benchmarks are absent from these workflows. The fork has no operator-selected fallback pool.

The required verdict retains the existing Linux, Node compatibility, Python x64 runtime, Windows build, and Windows native-test inputs. Windows coverage and observational checks keep their existing independent status. The additional Science job also reports independently: its failure remains visible without becoming a new required check before platform acceptance. Post-merge Python ARM64/macOS and Wine jobs also accept manual dispatch; the existing disabled macOS serial job stays disabled.

The Science job reads the pinned micromamba URL and SHA256 from the desktop resource manifest. The environment cache key and creation command share `.github/science-ci-spec.txt`. Short Windows prefixes accommodate conda-forge R package paths. Explicit `DSH_SCIENCE_REAL_PREFIX` selection prevents an incomplete environment setup from silently choosing another interpreter. Test execution remains eligible after setup failure but stops on workflow cancellation.

[The gate runner](../../../../scripts/run-gates.ts) includes `telemetry-receivers-test` in coverage aggregates. It invokes the current Node executable directly with the receiver test glob, without a build or package-manager installation. The required Linux coverage job therefore runs these otherwise undiscovered suites. Native Windows complete validation inherits the same leaf and its existing build ordering. Receiver tests use local fixtures; this decision adds no deployment or telemetry submission.

This note owns runner allocation for the fork's two CI workflows. It replaces their pool-selection prescriptions in the [failover runbook](2026-07-26-ci-failover-runbook.md), [Node compatibility decision](2026-09-06-node-compatibility-selfhosted.md), and [serial-reference decision](2026-07-21-serial-cross-platform-ci-reference.md). Publication and repository-management workflows remain separate owners.

## Alternatives considered

**Retain enterprise selectors and standby drills.** Their labels name infrastructure unavailable to this fork; a smaller concurrency budget cannot make those machines available.

**Run telemetry tests only as a workflow step.** That leaves local coverage aggregates unable to discover the Node test suites. One aggregate leaf keeps local and required CI execution aligned.

**Make the Science job required immediately.** Platform adaptation and real Windows acceptance are separate work. An independent job preserves its failure evidence without claiming that acceptance is complete.

## Consequences

The fork avoids dependence on private runner capacity and gives up its failover mechanism. Standard hosted resources can take longer; the reduced budgets are configuration choices, not measured platform acceptance. Science environment installation, real Windows execution, and release artifacts still require platform validation.

CI workflow specifications pin runner labels, required dependencies, Science environment selection, and cancellation behavior. Gate-runner specifications verify telemetry inclusion, execute the receiver suites through the actual leaf, and reject a missing suite. These tests validate configuration and local execution; they do not substitute for a completed GitHub Actions run.
