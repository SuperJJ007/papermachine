# Agent Note: DSH Science v0.1 R2 Science Runtime on RC5

Status: proposed

English | [中文](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)

## Problem

The accepted DSH Science v0.1 line has the official RC5 release baseline and the R1 Science Session domain, but it has no producer for `science/environment-bound`, `science/run-started`, or `science/run-finished`. The downstream Runtime at `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b` was built with four generic subprocess and sandbox extensions that RC5 does not contain. Its implementation commits also mix package code, existing-Consumer migrations, generated documentation, and unrelated repository repairs. Copying the downstream branch or cherry-picking those commits would therefore import work outside the Runtime's ownership.

R2 needs one executable RC5 plan that adds the host-local Science Runtime without pulling model-facing tools or a shipped Science composition forward. The plan must keep process ownership in the existing subprocess and sandbox capabilities, make durable Session mutation occur in the required order, preserve every existing Consumer's RC5 behavior, and separate fake-prefix source proof from real Python and R acceptance.

## Proposal

R2 adds the folded `@deepseek-ai/dsh-science-runtime` package to the accepted R1 line. The package owns `ctx.scienceRuntime`, strict configuration of existing local Conda prefixes, stable interpreter observation, exact-Session operation ownership, private Science scratch, direct Python/R argv construction, terminal classification, and the Session events produced by those operations. It composes `ctx.sessions`, a host-local `ctx.subprocess`, a fully enforcing `ctx.sandbox`, the accepted Science Session package, and its invariant. It registers no model tool, prompt, client projection, preset, or shipped application row.

R2 first adds only the generic capabilities the Runtime actually requires: an explicit subprocess environment base, a subprocess execution-world fact, retained-output UTF-8 validity, and shared sandbox runner/denial classification. Existing Consumers state their former RC5 choices explicitly and retain their behavior. The Runtime package is added only after those prerequisites pass independently. The R version-probe correction remains a separate commit and evidence identity inside R2.

The [R0 closure record](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) owns the overlay identities and evidence classes. The [R1 Science Session decision](../../implemented/feature/2026-08-15-dsh-science-v01-r1-science-session.md) owns the durable event semantics that Runtime operations must append. The generic subprocess, sandbox, Session, timeout, home-path, and invariant packages retain ownership of their existing responsibilities; R2 extends those owners rather than implementing private substitutes in Science.

### Exact identities

| Object | Identity | R2 use |
|---|---|---|
| Official RC5 source | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5` | Immutable upstream product baseline |
| Accepted R1 head | `7e11de7e4beaf17dd87cf19368cfc930837dc77c` on `codex/science-v01-r1-science-session` | Required ancestor and parent of the R2 plan commit |
| Downstream Runtime source | `omdsh-dev/dsh-science@e5e8b29b435f67e0a5dde5e2132580966e78b27b`; `packages/science/science-runtime/**` | Read-only final Runtime semantics and file source before the R-probe correction |
| Downstream Runtime history | `bf4be838066576dc005822428e259673b049e048`, `2386ad5d675141495777f5753b6911cd27608302`, and `390fbde6c1` | Provenance for initial implementation, hardening, and cancellation-cleanup containment; never a cherry-pick range |
| R version-probe correction | `b15f1ef42e92b72ad1b53412966408415f669a18`; only its `Rscript --version` behavior, focused tests, and matching Runtime prose | Separate R2 code/evidence identity; its Phase 3 parent and unrelated Runtime differences are excluded |
| R2 implementation base | The accepted commit containing this triplet, with `7e11de7e4b` as its parent and no product change | Parent of the first R2 implementation commit; record the exact SHA before product edits |

No downstream test result, review verdict, build output, real-machine report, Phase 3 candidate, or current `main` worktree state is acceptance evidence for the RC5 port. Grok must derive every final claim from the R2 tree at its exact SHA.

### Entry conditions

| Condition | Required evidence | Hard stop |
|---|---|---|
| Isolated implementation worktree | Create a new branch and worktree from the accepted R2 plan commit; `git status --porcelain=v1 --untracked-files=all` is empty before product edits | Reusing, cleaning, staging, resetting, or repointing any existing worktree |
| R1 ancestry | `git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD` succeeds; the pre-product diff contains only this proposed triplet | A different product base, a merge from downstream history, or unexplained pre-existing product changes |
| Read-only sources | The exact `e5e8b29...`, `bf4be8...`, `2386ad5...`, `390fbde...`, and `b15f1ef...` objects resolve locally without editing their worktrees | A missing source identity, an attempt to use a moving branch name, or a need to mutate a source worktree |
| Supported toolchain | Node satisfies `^22.19.0 || >=24.0.0`, pnpm is `11.7.0`, and the frozen install is usable | Changing product design or dependency versions to bypass a host failure |
| Protected state | Record the branch/HEAD/status of every pre-existing worktree before implementation | Any plan to absorb, clean, or reinterpret protected dirty or untracked content |
| Real acceptance inputs | Before closure, identify explicit existing Conda Python and R prefixes plus an isolated, test-owned, non-temporary mode-`0700` DSH home | Auto-discovery, Conda mutation, use of `/tmp`, or treating an unavailable language as PASS |

Implementation must re-derive patches against RC5. It must not rebase, merge, or cherry-pick downstream history.

### Scope

| Direction | Delta | Allowed result |
|---|---|---|
| IN | `GEN-SUBPROCESS-RUNTIME-FACTS` | Add required `environmentBase` (`scrubbed-parent` or `empty`), readonly `executionWorld` (`host-local` or `remote`), and `utf8Validity` (`valid`, `invalid`, or `unknown`); update providers, existing Consumers, mocks, tests, and owned documentation so RC5 behavior remains explicit |
| IN | `GEN-SANDBOX-CLASSIFICATION` | Move the shared runner-spawn, runner-fatal, and denial classifiers into `@deepseek-ai/dsh-sandbox`; update Bash and Pwsh to call one implementation and keep runner failure above denial |
| IN | `SCI-RUNTIME` | Add `packages/science/science-runtime/**`: folded service/local provider, strict configuration, stable prefix observation, exact-Session leases, owned scratch, direct execution, lifecycle settlement, invariant companion, package documentation, fake-prefix tests, Loader composition, and opt-in real acceptance |
| IN | `SCI-R-PROBE` | Apply only the standalone `Rscript --version` correction from `b15f1ef...`, with the focused invalid-outcome and argv tests plus matching Runtime prose |
| IN | Mechanical integration | RC5-aligned package metadata, TypeScript paths/references, lockfile importer, package and capability documentation, model-experience/invariant registrations, the minimum config-catalog support proven necessary, and outputs from owning generators |
| IN | Closure evidence | Move this triplet to `implemented/feature` only after the exact candidate passes; add one dated R2 evidence triplet that records actual commands, results, identities, exceptions, and `NOT-RUN` layers |
| OUT | Model-facing Science work | `GEN-RUNTIME-CONTEXT`, filesystem read-only entries, `tool-science`, tool schemas, prompt text, Science preset, snapshots, Web composition, charts, Outcome Consumers, settings, sidebar, Client UI, and Desktop |
| OUT | Broader generic redesign | New process verbs, direct `node:child_process` ownership in Science, shell command construction, generic sandbox-policy redesign, remote scratch protocols, confidentiality claims, or unrelated subprocess/sandbox refactors |
| OUT | Environment management and distribution | Conda discovery, create/clone/install/update/repair/delete, credentials, provider calls, installer, signing, notarization, publication, tag, release, Git push, PR, RC6, or latest-upstream migration |

The historical `scripts/rescope-vendor.ts` change in `2386ad5...`, the root BSD-license prose change, Phase 3 files, and every other change not required by the rows above are explicitly excluded.

### Required generic capabilities

`SubprocessSpawnSpec.environmentBase` is required. Existing Consumers use `'scrubbed-parent'`, preserving RC5 behavior; Science uses `'empty'` and supplies only its fixed allowlist. Local and E2B providers apply the selected base before `spec.env`. Provider transport processes may keep their own documented environment, but the target program may not inherit it accidentally.

`SubprocessRuntime.executionWorld` reports `'host-local'` or `'remote'`. Local subprocess reports `'host-local'`; E2B reports `'remote'`. Science rejects a remote world before it creates an owner marker, scratch directory, or Session event. This fact does not become a general remote-provider identity protocol and does not duplicate a sandbox field.

`SubprocessOutputRead.utf8Validity` describes the exact represented byte slice. A provider that retains or recovers those bytes reports `valid` or `invalid`; `unknown` is allowed only when the provider has decoded text but no recoverable bytes. Existing text Consumers otherwise preserve their behavior. Science version and UTF-8 probes require a lossless offset-zero read with `utf8Validity === 'valid'`.

Runner-spawn, runner-fatal, and denial classification move to an exported sandbox module. Bash, Pwsh, and Science call that module. A positively identified runner failure means the requested program did not run and therefore outranks a denial signature; exit status alone never proves either result.

If RC5's config-catalog generator cannot follow the Runtime's imported `configSchema`, R2 may add the smallest local-schema resolution required to document that package, with owning generator tests. The failure must be reproduced first. No unrelated generator change is authorized.

### Science Runtime behavior

The folded package exposes `bindEnvironment({ session, profileId, signal })`, `startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })`, and a `ScienceRunHandle` containing only `runId`, `done`, and idempotent `cancel()`. Public operation and result types contain no PID, subprocess handle, Conda implementation type, or host scratch path. A later tool Consumer calls these operations; it must never append Runtime-owned Science events itself.

Profiles name existing absolute Conda prefixes and at least one Python or R interpreter. The Runtime never invokes Conda or writes the configured prefix. It canonicalizes the prefix and executable, requires regular in-prefix interpreter/history files, records stable before/after identity, retries one changed observation once, and publishes an honest invalid or drifted binding instead of manufacturing stability.

Binding and run setup share a non-queuing exact-Session reservation. A second operation on the same live Session returns `RUNTIME_BUSY`. A detached lifecycle retains a same-ID quarantine until every owned probe and process tree is quiescent and cleanup has settled. Each append rechecks `ctx.sessions.get(session.id) === session`, so an old object cannot write into a same-ID successor.

Environment binding observes and confines the interpreter before appending one whole `science/environment-bound` value. A run writes and syncs the exact source and run directory, appends `science/run-started`, and only then spawns. After start commits, ordinary program failure, timeout, cancellation, sandbox denial, and runner failure become terminal values and append one matching `science/run-finished` only after whole-tree quiescence. A detached Session receives no terminal append; replay derives `interrupted` from the unmatched durable start. Failure to prove quiescence or commit a terminal fact never returns a value that looks durably settled.

Every probe and run uses direct argv, `environmentBase: 'empty'`, an owned cwd, fixed locale/timezone, and full `workspace-write` confinement. Python probes/runs use the frozen isolated UTF-8 flags. R version discovery uses standalone `Rscript --version`; its UTF-8 probe and runs use `--vanilla --encoding=UTF-8`. Scratch lives only below the resolved DSH home, uses exclusive owner markers and private modes, rejects symlinks and path overlap, and retains accepted run state while removing only unpublished setup that the current operation owns.

Confinement restricts documented file writes; it does not claim file-read, network, syscall, or scientific-result isolation. Windows remains fail-closed wherever the available sandbox cannot provide full enforcement. Source code, stdout, stderr, credentials, and absolute scratch paths never enter Science Session events or the public Science projection.

### RC5 adaptation and expected impact

The Runtime package manifest is re-derived from RC5 sibling packages: version `0.1.0-rc.5`, `publishConfig.access: public`, MIT, the shared repository field, and RC5 workspace dependency declarations. Its TypeScript references are re-derived against the RC5 layout and must not copy an unnecessary `vendor/cosmokit` reference. Downstream `0.0.1-rc.2`, restricted publication, and BSD metadata are forbidden.

| Area | Expected paths | Rule |
|---|---|---|
| Subprocess definition/providers | `packages/subprocess/subprocess/**`, `packages/subprocess/subprocess-local/**`, `packages/e2b/subprocess-e2b/**` | Add only the three declared facts and provider behavior required to honor them |
| Existing subprocess Consumers | `packages/shell/bash-local/**`, `packages/shell/pwsh-local/**`, `packages/fs/tool-fs-search/**`, `packages/lsp/lsp-stdio/**`, `packages/subagent/subagent-acp/**`, `packages/subagent/subagent-claude-code/**`, `packages/subagent/subagent-codex/**`, terminal tests, and exact E2B fixtures | State former scrubbed-parent behavior and complete new required mock facts; no Consumer semantics change |
| Sandbox classification | `packages/sandbox/sandbox/**`, `packages/shell/bash-sandbox/**`, `packages/shell/pwsh-sandbox/**` | One classifier owner; delete deliberate duplicate helpers only after both Consumers pass |
| Science Runtime | `packages/science/science-runtime/**`, `packages/science/README.*` | Reproduce final `e5e8b29...` Runtime semantics on RC5, then apply the isolated R-probe correction |
| Package/tooling integration | `packages/README.*`, `tsconfig.base.json`, `tsconfig.host.json`, `pnpm-lock.yaml`, and minimum required generator/allowlist sources | Every path must be required by the new package or one declared generic API |
| Generated/current documentation | Affected `docs/architecture.*`, subsystem/config/capability/event/module references, `packages/extensions/tool-cordis/src/api-catalog.ts`, and pairing sidecars | Edit owners first, regenerate English/catalog artifacts, then update reviewed Chinese counterparts |
| Decision/evidence | This triplet and one dated R2 closure-evidence triplet | Stable rationale stays here; volatile SHA and command results stay in evidence |

`pnpm --silent run change-scope --base <R2-plan-base> --head HEAD` must account for the final path list. A changed path outside these categories is a hard stop unless an owning generator names it or this Note is amended before the product change.

### Implementation stages and commit boundaries

1. Record the exact R2 plan base, protected-worktree inventory, toolchain, source objects, and empty product diff. Build a path-by-path mapping from the final downstream files to RC5, classifying every historical path as required, generated, adapted, or excluded before copying code.
2. Implement `GEN-SUBPROCESS-RUNTIME-FACTS` as one independently reviewable commit. Add focused definition, local, E2B, and existing-Consumer tests; do not add Science code in this commit.
3. Implement `GEN-SANDBOX-CLASSIFICATION` as one independently reviewable commit. Move only the shared classification behavior, test precedence and spawn identity, and prove Bash/Pwsh behavior remains unchanged.
4. Add the RC5-aligned Science Runtime package, Loader composition, fake-prefix tests, package integration, and owner documentation as one product commit. Use the final `e5e8b29...` tree as semantic source, including the `2386ad5...` and `390fbde...` hardening already present there; do not replay their unrelated paths.
5. Apply the `b15f1ef...` R-probe correction as a separate commit. Copy only the standalone R version argv behavior, its focused tests, and matching Runtime prose; do not copy its Phase 3 parent or unrelated package differences.
6. Run the verification matrix on the complete candidate, review the exact diff, and obtain one clean-context review limited to the changed generic APIs and Runtime lifecycle/security invariants. A material repair creates a new candidate and reruns affected checks and the focused review.
7. After every required evidence layer passes, add dated closure evidence and move this triplet to `implemented/feature`, rewriting it into present-tense `Decision` and `Consequences` sections. Stop before Runtime Context, filesystem read-only, tools, preset, UI, Desktop, push, or release work.

### Verification matrix

| Evidence | Required command or observation | Acceptance rule |
|---|---|---|
| Scope and ancestry | `git merge-base --is-ancestor 7e11de7e4beaf17dd87cf19368cfc930837dc77c HEAD`; `pnpm --silent run change-scope --base <R2-plan-base> --head HEAD`; `git diff --check <R2-plan-base>..HEAD` | Every path maps to this Note or an owning generator; no downstream merge/cherry-pick ancestry |
| Generic subprocess behavior | Focused Vitest over `packages/subprocess/subprocess/tests`, `packages/subprocess/subprocess-local/tests`, `packages/e2b/subprocess-e2b/tests`, and every changed Consumer test directory | Empty/scrubbed bases, execution worlds, byte-slice validity, and unchanged existing Consumer behavior all pass |
| Sandbox classification | Focused Vitest over `packages/sandbox/sandbox/tests`, `packages/shell/bash-sandbox/tests`, and `packages/shell/pwsh-sandbox/tests` | Spawn identity and fatal-runner evidence are positive; runner failure outranks denial; both shell Consumers agree |
| Runtime behavior | `pnpm exec vitest run packages/science/science-runtime/tests packages/science/science-session/tests` plus the real Loader composition in the Runtime suite | Config, observation, scratch, start-before-spawn, exact Session, cancellation/timeout, quiescence, detachment, replay, prefix manifest, and R argv pass |
| Focused per-file coverage | Targeted Vitest coverage including `packages/science/science-runtime/src/**` and every generic source file changed for R2 | Every included source file reaches 100% statements, branches, functions, and lines under canonical exclusions; thresholds and unjustified ignores are not relaxed |
| Static and package artifacts | `pnpm run typecheck`; `pnpm run check:ci:artifacts` | Source/build faces, declarations, publint, built package invariants, NodeNext consumption, and built entries pass |
| Hygiene | `pnpm run hygiene`; if it stops only at the known `rescope-vendor:check` baseline gap, rerun subsequent subchecks individually and compare the failure list byte-for-byte with the R2 plan base | Any new or changed hygiene finding blocks acceptance; a reproduced unchanged baseline gap is disclosed, never called PASS |
| Documentation | Named pairing re-records; `pnpm run doc-sync`; `pnpm run lint` | Generated sources are fresh, all pairs match in structure and meaning, and prose names current R2 behavior without Phase 3 claims |
| Real Python/R | On the exact candidate with Node 24+, explicit existing prefixes, and an isolated non-temporary mode-`0700` DSH home: `pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance` with its documented opt-in variables | Machine-readable Python and R reports are independently `PASS`; prefix manifest differences are empty; a skipped/unavailable language is not closure |
| Exact candidate review | One fresh reviewer receives base/head, IN/OUT table, source mapping, full diff, focused results, real reports, and `NOT-RUN` list | Review covers only changed generic contracts and Runtime lifecycle/security invariants; a verdict for another SHA is invalid |

The exact real-runtime command is:

```sh
DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1 \
DSH_SCIENCE_RUNTIME_TEST_OWNED=1 \
DSH_SCIENCE_RUNTIME_DSH_HOME=<absolute-non-temp-mode-0700-test-home> \
DSH_SCIENCE_RUNTIME_PYTHON_PREFIX=<absolute-existing-python-prefix> \
DSH_SCIENCE_RUNTIME_R_PREFIX=<absolute-existing-r-prefix> \
pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance
```

The final local run does not repeat the repository-wide unit suite, model snapshots, browser suites, provider e2e, Desktop, installer, signing, or release checks. They do not match R2's non-model-facing, unshipped scope. CI owns exhaustive repository coverage and the platform matrix; R2 locally runs only the targeted behavior, required static/artifact, documentation, hygiene, and real-runtime evidence above.

## Alternatives considered

**Cherry-pick `bf4be8...`, `2386ad5...`, `390fbde...`, or the R-probe branch.** Rejected because those histories contain mixed generic migrations, generated outputs, unrelated repairs, or Phase 3 ancestry. Exact commits are provenance, not patch boundaries for the unrelated RC5 line.

**Port the Runtime package before its generic requirements.** Rejected because Science would then duplicate environment construction, execution-world checks, byte-validity inference, or sandbox classification. Those responsibilities already belong to shared capabilities and must remain independently usable and testable.

**Put generic prerequisites and Runtime into one large commit.** Rejected because a required-field subprocess migration touches many existing Consumers while the Runtime adds independent lifecycle and filesystem ownership. Separate commits make compatibility regressions and scope growth attributable.

**Add `tool-science` so the Runtime has a production Consumer.** Rejected because tools are model-facing and depend on Runtime Context, filesystem read-only behavior, prompt/schema decisions, snapshots, and a later preset. R2 is pre-product infrastructure and does not claim a complete three-role capability seam.

**Use `node:child_process` or a shell command inside Science.** Rejected because it would duplicate process-tree ownership, output retention, termination, quiescence, quoting, and sandbox integration already owned by `ctx.subprocess` and `ctx.sandbox`.

**Auto-discover or manage Conda environments.** Rejected because discovery, solving, installation, mutation locks, approvals, rollback, and deletion form a separate product capability. R2 observes and executes only explicitly configured existing prefixes.

**Accept fake-prefix tests as Runtime completion.** Rejected because deterministic source tests cannot prove a real Python or R executable, OS confinement, environment scrubbing, process-tree settlement, or prefix non-mutation on the accepted SHA.

## Supersession and lifecycle

This Note does not supersede the Science Session, subprocess, sandbox, session-log, timeout, home-path, invariant, or distribution decisions. It consumes or narrowly extends them. The implemented form must link back to those owners and state only the behavior that actually lands.

This proposed triplet remains active until R2 is implemented or rejected and is never archived while proposed. The final evidence record owns volatile candidate SHAs, command outputs, host details, and reproduced baseline exceptions; this Note owns the stable scope, ordering, exclusions, and acceptance meaning.

## Acceptance criteria

- The accepted candidate descends from the recorded R2 plan base and contains no downstream merge/cherry-pick, Runtime Context, filesystem read-only, tool, preset, UI, Desktop, distribution, or latest-upstream work.
- Every existing subprocess Consumer preserves its RC5 behavior while explicitly selecting the environment base and supplying the new execution-world/output facts required by its role.
- Bash, Pwsh, and Science use the same sandbox classifier; positive runner failure outranks denial and an ordinary program failure is not misreported as infrastructure failure.
- The Runtime requires an exact live Science Session, host-local subprocess world, full sandbox enforcement, and configured existing prefix before creating durable facts or accepted scratch.
- `science/run-started` is durable before spawn; terminal settlement occurs only after whole-tree quiescence; detached or replaced Sessions never receive an old lifecycle's terminal append.
- Runtime operations never invoke Conda, mutate the configured prefix, inherit ambient credentials, expose host scratch through public results, or place code/stdout/stderr in the Session log or public Science projection.
- The final Runtime uses standalone `Rscript --version`; focused tests reject the former combined version argv and real Python and R acceptance each report `PASS` with an empty prefix-manifest diff on the exact candidate.
- Every changed source file included by the focused coverage plan reaches 100%; required static, artifact, hygiene, documentation, and focused review checks satisfy the matrix without weakening gates.
- Closure evidence separates source/fake-prefix, built artifact, real Python, real R, and `NOT-RUN` product/distribution layers. The implementation worktree is clean and every protected worktree/ref matches its entry snapshot.

## Risks

- The required subprocess fields create a broad compile-time migration across existing Consumers. Mechanical edits can hide changed defaults, so each Consumer must state its former RC5 choice and its owning tests must exercise it.
- Exact-Session reservation and same-ID quarantine can leak permanently if a failure path releases before quiescence or never releases after positive proof. Tests must cover cancellation, timeout, detachment, service disposal, terminal-commit rejection, and late quiescence.
- A sandbox runner diagnostic can resemble a program denial. Weak classification could report a program that never ran as an ordinary Science failure, while overly broad matching could hide a real program failure as infrastructure failure.
- Host scratch cleanup is destructive within test-owned paths. Implementation must resolve and verify exact owner markers and path containment before removal; it must never use broad cleanup against a configured prefix, repository, home, or pre-existing worktree.
- File-write confinement is narrower than confidentiality. Documentation and results must not imply protection from file reads, networking, syscalls, or scientifically incorrect code.
- Real acceptance depends on current host interpreters and confinement support. An environment or host failure remains literal FAIL/NOT-RUN evidence until rerun successfully on the exact candidate; historical downstream PASS does not close R2.
- Generated and integration paths can conceal Phase 3 leakage. Any unexplained path, new model-visible text, shipped composition row, or need for `agent-loop` changes stops implementation for an explicit plan amendment.
