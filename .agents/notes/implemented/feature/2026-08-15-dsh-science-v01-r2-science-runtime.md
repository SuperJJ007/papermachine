# Agent Note: DSH Science v0.1 R2 Science Runtime on RC5

Status: implemented

English | [中文](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)

## Problem

The accepted DSH Science v0.1 line has the official RC5 release baseline and the R1 Science Session domain, but it has no producer for `science/environment-bound`, `science/run-started`, or `science/run-finished`. The downstream Runtime at `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` was built with four generic subprocess and sandbox extensions that RC5 does not contain. Its implementation commits also mix package code, existing-Consumer migrations, generated documentation, and unrelated repository repairs. Copying the downstream branch or cherry-picking those commits would therefore import work outside the Runtime's ownership.

R2 needs one executable RC5 plan that adds the host-local Science Runtime without pulling model-facing tools or a shipped Science composition forward. The plan must keep process ownership in the existing subprocess and sandbox capabilities, make durable Session mutation occur in the required order, preserve every existing Consumer's RC5 behavior, and separate fake-prefix source proof from real Python and R acceptance.

## Decision

R2 adds the folded `@deepseek-ai/dsh-science-runtime` package to the accepted R1 line. The package owns `ctx.scienceRuntime`, strict configuration of existing local Conda prefixes, stable interpreter observation, exact-Session operation ownership, private Science scratch, direct Python/R argv construction, terminal classification, and the Session events produced by those operations. It composes `ctx.sessions`, a host-local `ctx.subprocess`, a fully enforcing `ctx.sandbox`, the accepted Science Session package, and its invariant. It registers no model tool, prompt, client projection, preset, or shipped application row.

R2 first adds only the generic capabilities the Runtime actually requires: an explicit subprocess environment base, a subprocess execution-world fact, retained-output UTF-8 validity, and shared sandbox runner/denial classification. Existing Consumers state their former RC5 choices explicitly and retain their behavior. The Runtime package lands only after those prerequisites pass independently. The R version-probe correction remains a separate commit and evidence identity inside R2.

The [R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) owns the overlay identities and evidence classes. The [R1 Science Session decision](2026-08-15-dsh-science-v01-r1-science-session.md) owns the durable event semantics that Runtime operations append. The [dated R2 evidence record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r2-science-runtime.md) owns volatile candidate SHAs, command outputs, host prefixes, and reproduced baseline exceptions. The generic subprocess, sandbox, Session, timeout, home-path, and invariant packages retain ownership of their existing responsibilities; R2 extends those owners rather than implementing private substitutes in Science.

### Exact identities

| Object | Identity | R2 use |
|---|---|---|
| Official RC5 source | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5` | Immutable upstream product baseline |
| Accepted R1 head | `7e11de7e4beaf17dd87cf19368cfc930837dc77c` on `codex/science-v01-r1-science-session` | Required ancestor of the R2 plan commit |
| Downstream Runtime source | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/science/science-runtime/**` | Read-only final Runtime semantics and file source before the R-probe correction |
| Downstream Runtime history | `bf4be838066576dc005822428e259673b049e048`, `2386ad5d675141495777f5753b6911cd27608302`, and `390fbde6c1` | Provenance for initial implementation, hardening, and cancellation-cleanup containment; never a cherry-pick range |
| R version-probe correction | `b15f1ef42e92b72ad1b53412966408415f669a18`; only its `Rscript --version` behavior, focused tests, and matching Runtime prose | Separate R2 code/evidence identity; its Phase 3 parent and unrelated Runtime differences are excluded |
| R2 plan base | `a1c9ba2a48c9ccc6895f821456a4d2942c6ebe2c` on `codex/science-v01-r2-runtime-plan` | Parent of the first R2 implementation commit; contains this triplet and no product change |

No downstream test result, review verdict, build output, real-machine report, Phase 3 candidate, or current `main` worktree state is acceptance evidence for the RC5 port. Every final claim is derived from the R2 tree at the SHA recorded in the dated evidence record.

### Scope

| Direction | Delta | Result |
|---|---|---|
| IN | `GEN-SUBPROCESS-RUNTIME-FACTS` | Required `environmentBase` (`scrubbed-parent` or `empty`), readonly `executionWorld` (`host-local` or `remote`), and `utf8Validity` (`valid`, `invalid`, or `unknown`); providers, existing Consumers, mocks, tests, and owned documentation keep RC5 behavior explicit |
| IN | `GEN-SANDBOX-CLASSIFICATION` | Shared runner-spawn, runner-fatal, and denial classifiers live in `@deepseek-ai/dsh-sandbox`; Bash and Pwsh call that one implementation and keep runner failure above denial |
| IN | `SCI-RUNTIME` | `packages/science/science-runtime/**`: folded service/local provider, strict configuration, stable prefix observation, exact-Session leases, owned scratch, direct execution, lifecycle settlement, invariant companion, package documentation, fake-prefix tests, Loader composition, and opt-in real acceptance |
| IN | `SCI-R-PROBE` | Standalone `Rscript --version` from `b15f1ef...`, with the focused invalid-outcome and argv tests plus matching Runtime prose |
| IN | Mechanical integration | RC5-aligned package metadata, TypeScript paths/references, lockfile importer, package and capability documentation, model-experience/invariant registrations, imported-`configSchema` catalog walk, and outputs from owning generators |
| IN | Closure evidence | This triplet in `implemented/feature` and one dated R2 evidence triplet that records actual commands, results, identities, exceptions, and `NOT-RUN` layers |
| OUT | Model-facing Science work | `GEN-RUNTIME-CONTEXT`, filesystem read-only entries, `tool-science`, tool schemas, prompt text, Science preset, snapshots, Web composition, charts, Outcome Consumers, settings, sidebar, Client UI, and Desktop |
| OUT | Broader generic redesign | New process verbs, direct `node:child_process` ownership in Science, shell command construction, generic sandbox-policy redesign, remote scratch protocols, confidentiality claims, or unrelated subprocess/sandbox refactors |
| OUT | Environment management and distribution | Conda discovery, create/clone/install/update/repair/delete, credentials, provider calls, installer, signing, notarization, publication, tag, release, Git push, PR, RC6, or latest-upstream migration |

The historical `scripts/rescope-vendor.ts` change in `2386ad5...`, the root BSD-license prose change, Phase 3 files, and every other change not required by the rows above remain excluded.

### Required generic capabilities

`SubprocessSpawnSpec.environmentBase` is required. Existing Consumers use `'scrubbed-parent'`, preserving RC5 behavior; Science uses `'empty'` and supplies only its fixed allowlist. Local and E2B providers apply the selected base before `spec.env`. Provider transport processes may keep their own documented environment, but the target program may not inherit it accidentally.

`SubprocessRuntime.executionWorld` reports `'host-local'` or `'remote'`. Local subprocess reports `'host-local'`; E2B reports `'remote'`. Science rejects a remote world before it creates an owner marker, scratch directory, or Session event. This fact is not a general remote-provider identity protocol and does not duplicate a sandbox field.

`SubprocessOutputRead.utf8Validity` describes the exact represented byte slice. A provider that retains or recovers those bytes reports `valid` or `invalid`; `unknown` is allowed only when the provider has decoded text but no recoverable bytes. Existing text Consumers otherwise preserve their behavior. Science version and UTF-8 probes require a lossless offset-zero read with `utf8Validity === 'valid'`.

Runner-spawn, runner-fatal, and denial classification live in an exported sandbox module. Bash, Pwsh, and Science call that module. A positively identified runner failure means the requested program did not run and therefore outranks a denial signature; exit status alone never proves either result.

The config-catalog generator follows a same-package imported `configSchema` so the Runtime package is documented without unrelated generator work.

### Science Runtime behavior

The folded package exposes `bindEnvironment({ session, profileId, signal })`, `startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })`, and a `ScienceRunHandle` containing only `runId`, `done`, and idempotent `cancel()`. Public operation and result types contain no PID, subprocess handle, Conda implementation type, or host scratch path. A later tool Consumer calls these operations; it must never append Runtime-owned Science events itself.

An empty profile map is a valid explicit unconfigured state. Every declared profile names existing absolute Conda prefixes and at least one Python or R interpreter. The separate `@deepseek-ai/dsh-science-runtime/with-settings` entry injects `settings` and treats the Cordis `profiles` map as the composition `base` of the restart-scoped `science-runtime` namespace; it snapshots that resolved map once at load, so a write changes only the next Host start. The root entry never reads settings. The Runtime never invokes Conda or writes the configured prefix. It canonicalizes the prefix and executable, requires regular in-prefix interpreter/history files, records stable before/after identity, retries one changed observation once, and publishes an honest invalid or drifted binding instead of manufacturing stability.

Binding and run setup share a non-queuing exact-Session reservation. A second operation on the same live Session returns `RUNTIME_BUSY`. A detached lifecycle retains a same-ID quarantine until every owned probe and process tree is quiescent and cleanup has settled. Each append rechecks `ctx.sessions.get(session.id) === session`, so an old object cannot write into a same-ID successor.

Environment binding observes and confines the interpreter before appending one whole `science/environment-bound` value. A run writes and syncs the exact source and run directory, appends `science/run-started`, and only then spawns. After start commits, ordinary program failure, timeout, cancellation, sandbox denial, and runner failure become terminal values and append one matching `science/run-finished` only after whole-tree quiescence. A detached Session receives no terminal append; replay derives `interrupted` from the unmatched durable start. Failure to prove quiescence or commit a terminal fact never returns a value that looks durably settled.

Every probe and run uses direct argv, `environmentBase: 'empty'`, an owned cwd, fixed locale/timezone, and full `workspace-write` confinement. Python probes/runs use the frozen isolated UTF-8 flags. R version discovery uses standalone `Rscript --version`; its UTF-8 probe and runs use `--vanilla --encoding=UTF-8`. Scratch lives only below the resolved DSH home, uses exclusive owner markers and private modes, rejects symlinks and path overlap, and retains accepted run state while removing only unpublished setup that the current operation owns.

Confinement restricts documented file writes; it does not claim file-read, network, syscall, or scientific-result isolation. Windows remains fail-closed wherever the available sandbox cannot provide full enforcement. Source code, stdout, stderr, credentials, and absolute scratch paths never enter Science Session events or the public Science projection.

### RC5 adaptation

The Runtime package manifest is re-derived from RC5 sibling packages: version `0.1.0-rc.5`, `publishConfig.access: public`, MIT, the shared repository field, and RC5 workspace dependency declarations. Its TypeScript references are re-derived against the RC5 layout and do not copy an unnecessary `vendor/cosmokit` reference. Downstream `0.0.1-rc.2`, restricted publication, and BSD metadata are absent.

| Area | Paths | Rule |
|---|---|---|
| Subprocess definition/providers | `packages/subprocess/subprocess/**`, `packages/subprocess/subprocess-local/**`, `packages/e2b/subprocess-e2b/**` | Add only the three declared facts and provider behavior required to honor them |
| Existing subprocess Consumers | `packages/shell/bash-local/**`, `packages/shell/pwsh-local/**`, `packages/fs/tool-fs-search/**`, `packages/lsp/lsp-stdio/**`, `packages/subagent/subagent-acp/**`, `packages/subagent/subagent-claude-code/**`, `packages/subagent/subagent-codex/**`, terminal tests, and exact E2B fixtures | State former scrubbed-parent behavior and complete new required mock facts; no Consumer semantics change |
| Sandbox classification | `packages/sandbox/sandbox/**`, `packages/shell/bash-sandbox/**`, `packages/shell/pwsh-sandbox/**` | One classifier owner; delete deliberate duplicate helpers only after both Consumers pass |
| Science Runtime | `packages/science/science-runtime/**`, `packages/science/README.*` | Reproduce final `e5e8b29...` Runtime semantics on RC5, then apply the isolated R-probe correction |
| Package/tooling integration | `packages/README.*`, `tsconfig.base.json`, `tsconfig.host.json`, `pnpm-lock.yaml`, and minimum required generator/allowlist sources | Every path must be required by the new package or one declared generic API |
| Generated/current documentation | Affected `docs/architecture.*`, subsystem/config/capability/event/module references, `packages/extensions/tool-cordis/src/api-catalog.ts`, and pairing sidecars | Edit owners first, regenerate English/catalog artifacts, then update reviewed Chinese counterparts |
| Decision/evidence | This triplet and one dated R2 closure-evidence triplet | Stable rationale stays here; volatile SHA and command results stay in evidence |

## Alternatives considered

**Cherry-pick `bf4be8...`, `2386ad5...`, `390fbde...`, or the R-probe branch.** Rejected because those histories contain mixed generic migrations, generated outputs, unrelated repairs, or Phase 3 ancestry. Exact commits are provenance, not patch boundaries for the unrelated RC5 line.

**Port the Runtime package before its generic requirements.** Rejected because Science would then duplicate environment construction, execution-world checks, byte-validity inference, or sandbox classification. Those responsibilities already belong to shared capabilities and must remain independently usable and testable.

**Put generic prerequisites and Runtime into one large commit.** Rejected because a required-field subprocess migration touches many existing Consumers while the Runtime adds independent lifecycle and filesystem ownership. Separate commits make compatibility regressions and scope growth attributable.

**Add `tool-science` so the Runtime has a production Consumer.** Rejected because tools are model-facing and depend on Runtime Context, filesystem read-only behavior, prompt/schema decisions, snapshots, and a later preset. R2 is pre-product infrastructure and does not claim a complete three-role capability seam.

**Use `node:child_process` or a shell command inside Science.** Rejected because it would duplicate process-tree ownership, output retention, termination, quiescence, quoting, and sandbox integration already owned by `ctx.subprocess` and `ctx.sandbox`.

**Auto-discover or manage Conda environments.** Rejected because discovery, solving, installation, mutation locks, approvals, rollback, and deletion form a separate product capability. R2 observes and executes only explicitly configured existing prefixes.

**Accept fake-prefix tests as Runtime completion.** Rejected because deterministic source tests cannot prove a real Python or R executable, OS confinement, environment scrubbing, process-tree settlement, or prefix non-mutation on the accepted SHA.

## Supersession and lifecycle

This Note does not supersede the Science Session, subprocess, sandbox, session-log, timeout, home-path, invariant, or distribution decisions. It consumes or narrowly extends them. It links back to those owners and states only the behavior that landed.

This implemented triplet stays active because its alternatives, ownership boundary, negative guarantees, and real-acceptance split remain useful for later Science slices. The dated evidence record owns volatile candidate SHAs, command outputs, host details, and reproduced baseline exceptions; this Note owns the stable scope, ordering, exclusions, and acceptance meaning.

## Consequences

R2 gives Science a host-local producer for `science/environment-bound`, `science/run-started`, and `science/run-finished` without importing downstream history, model-facing tools, or a shipped composition. The cost is a required-field subprocess migration across existing Consumers and a Runtime that, at R2, still had no model-visible Consumer; [R3](2026-08-16-dsh-science-v01-r3-science-tools.md) adds that Consumer, while preset and UI slices remain OUT.

Exact-Session reservation and same-ID quarantine stay in front of every durable append; tests cover cancellation, timeout, detachment, service disposal, terminal-commit rejection, and late quiescence so a failure path cannot release before proof or hold a lease after proof. File-write confinement is narrower than confidentiality: documentation and results do not claim protection from file reads, networking, syscalls, or scientifically incorrect code.

Real Python and R acceptance remain opt-in and host-dependent. An environment or host failure is literal FAIL/`NOT-RUN` until a successful rerun on the recorded candidate; historical downstream PASS does not close R2. [R3](2026-08-16-dsh-science-v01-r3-science-tools.md) completes this Runtime with the model-facing `@deepseek-ai/dsh-tool-science` Consumer, after the generic runtime-context and filesystem read-only prerequisites it also adds; the built-in Science preset remains the next open slice.
