# Agent Note: Science preset gains a restricted subagent

Status: implemented

English | [中文](2026-09-02-science-restricted-subagent.zh.md)

## Problem

The `science` preset carried no delegation tool at all. A researcher whose task split into genuinely independent sub-work — literature search running alongside data exploration, or one exploratory analysis long enough to run on its own while the agent kept working elsewhere — had no way to parallelize it: the agent had to do everything itself, in sequence, in its own kernel.

Every other shipped preset (`standard`/`code`/`cordis`) composes a `delegation` group giving the model `subagent`, `subagent_fork`, `send_message`, `interrupt_agent`, and `list_agents`, plus workflow tooling. None of that is a fit for Science as-is: a spawned child inherits its parent's whole tool roster by default (`composeFrom()` joins the same standing composition), so copying `standard`'s group verbatim would hand a Science child shell, file write/edit, package installs, and unlimited further delegation — exactly the capabilities the preset's own header comment lists as deliberately absent from the parent.

The product decision (this repository's user, 2026-09-02) was to ship a **restricted** subagent now rather than wait for a fuller design: narrow the child down with `toolFilter`/`maxDepth` instead of building Science's eventual role-based Specialists (per-role personas, result merging across children, persistent child identity, a resume contract) in this change.

## Decision

**Science composes its own `delegation` group with three rows**, structurally modeled on `standard`'s but cut down to exactly what the restricted design needs:

- `tool-subagent-control` (`send_message`, `interrupt_agent`) and `tool-subagent-control/list-agents` (`list_agents`) — the shared child-messaging/listing tools, unchanged from `standard`.
- One `tool-subagent` instance: `provider: spawn`, `toolName: subagent`, `backgroundMode: continuable`, `maxDepth: 1`, a child-scoped `persona`, and a `toolFilter.deny` list.

**No fork, no Codex, no Claude Code, no workflow tooling.** `standard`'s `tool-subagent-fork`, disabled `tool-subagent-codex`/`tool-subagent-claude-code` rows, `workflow-worker-thread`, `tool-workflow`, and `tool-ralph` are all absent. Fork reuses completed parent history the way a spawned Science child should not (it starts a fresh kernel by design, so replaying parent turns into its prompt only invites the model to assume shared state that does not exist); the other providers are optional Bundles this deployment does not install; workflow tooling is an unrelated capability this restricted cut does not add.

**`maxDepth: 1` forbids a grandchild.** The spawned child's own `tool-subagent` row (inherited through `composeFrom()`) carries the same cap, so an attempted further delegation is rejected by the depth check at start — independently of `toolFilter` denying the child's own `subagent` tool outright. Both mechanisms enforce the same boundary; neither alone would be enough on its own to explain in a review, so both are present and documented together.

**`toolFilter` uses `deny`, not `allow`.** An `allow` list has to be kept in sync with the parent's full roster or it silently strips something Science actually wants the child to keep (`report`, `read`, `glob`/`grep`, `skill`, `web_search`/`web_fetch`, `todo_write`); a `deny` list names exactly the handful of capabilities being removed and leaves everything else — including any future addition to the parent's roster — visible by default. The denied names are `install_science_packages` (no package installs from inside a child), `subagent` (no further delegation, redundant with `maxDepth: 1`), `send_message`/`interrupt_agent`/`list_agents` (a child cannot message or manage siblings — it is not a coordinator), `exit_plan_mode` (plan mode is a parent-level workflow the child has no reason to invoke), and `ask_user_question` (a child reports to its parent, not to the user directly).

**No `isolate: workflowEngine` on this group.** `standard`'s `delegation` group carries that realm because it also composes `workflow-worker-thread`/`tool-workflow`/`tool-ralph`, the only rows in the repository that inject `ctx.workflowEngine`; nothing in this group's three rows touches it, and the group publishes no service of its own — checked directly against `packages/workflow/*/src/index.ts`'s `inject` lists, none of which this preset composes.

**The `spawn` provider and the shared `subagents`/control tool packages are already available.** `packages/bundle/base/cordis.patch.yml` mounts `subagent`, `subagent-spawn-in-process`, `tool-subagent-control`, and `tool-subagent-control/list-agents` at the host root for every profile that includes the base bundle; this preset's rows resolve that existing host registry, exactly as `standard`'s do, and need no new bundle wiring.

**The child persona** states five things in Chinese, matching the product's Chinese-first working style: it is a PaperMachine Science subagent doing exactly the one task it was given; it runs its own kernel with none of the parent's variables (recompute or re-read anything needed); its workspace is read-only and it cannot install packages; it must `report` its conclusion, key numbers, and every artifact's `logical_name` before stopping; and it should report uncertainty rather than guess.

**The parent persona gains three sentences** on when to delegate (genuinely independent parallel work, or a long exploratory analysis that can run unattended), a reminder that the child's kernel starts empty, and an instruction to verify a child's reported numbers before repeating them.

## Alternatives considered

- **Reuse `standard`'s `delegation` group verbatim.** Rejected: it would hand a Science child shell and file write/edit — capabilities Science's own design (read-only workspace, no shell) never grants at the parent level either — plus fork, Codex/Claude Code provider rows, and workflow tooling, none of which fit a first restricted cut.
- **An `allow` list instead of `deny`.** Rejected: `allow` must enumerate every tool the child should keep, so it silently strips a future roster addition (a newly composed row) unless this preset's `toolFilter` is remembered and updated in lockstep; `deny` only has to name what is being removed.
- **Skip `maxDepth: 1` since `toolFilter` already denies `subagent`.** Rejected: `toolFilter` is a visibility restriction on THIS child's own tool schema, not an authority ceiling the runtime otherwise enforces (`docs/subsystems/subagent.md`'s `maxDepth` field is the actual depth cap); relying on tool-schema removal alone would leave no runtime backstop if a future change to this preset's `toolFilter` were incomplete.
- **Build Science's role-based Specialists design now instead of a restricted generic subagent.** Deferred, not rejected: per-role personas, cross-child result merging, persistent child identity, and a resume contract are real product needs but a substantially larger design than this change. The explicit product decision was to ship the narrower, already-useful capability first.

## Consequences

The `science` preset's model tool roster grows from thirteen to seventeen tools (excluding the conditionally present `glob`/`grep`): adds `interrupt_agent`, `list_agents`, `send_message`, `subagent`. `apps/cli/tests/web-agent-presets.e2e.ts`'s exact-roster assertion for `science` is updated accordingly, and its isolation test now asserts `science` and `standard` both carry `subagent` (dropping it from the forbidden-tool list) while `bash`/`write`/`edit` remain forbidden to `science`. `apps/web/tests/science-preset.snapshot.ts`'s roster assertion is updated the same way; its `session.jsonl` fixture predates this change and needs re-recording with a live key before that suite's replay mode is trustworthy again — the same known follow-up already open from the 2026-09-01 web/plan change, not newly introduced here. `docs/subsystems/science.md`/`.zh.md` name the new restricted-subagent composition and link this note.

## Testing

`packages/preset` and `apps/cli` unit/e2e suites, `examples/headless-agent`'s keyless snapshot suite (unaffected: its `science-tools` scenario composes `dsh-tool-science` directly, not the `science` preset), `verify-cordis-config`, and `verify-translation-pairing`/`verify-doc-refs` for the documentation changes. Two real-API delegation calls against the assembled `science` preset (a real Conda-backed kernel, not a fixture) verify the child's tool roster is actually restricted at runtime and that the child runs its own kernel, separate from the parent's — see the PR description for the exact transcripts and a browser screenshot of the delegation rendered in the conversation.
