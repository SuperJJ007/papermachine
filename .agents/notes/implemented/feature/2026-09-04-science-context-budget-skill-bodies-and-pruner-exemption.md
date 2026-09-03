# Agent Note: Science context budget — exempt skill pruning, shrink bundled skill bodies

Status: implemented

English | [中文](2026-09-04-science-context-budget-skill-bodies-and-pruner-exemption.zh.md)

## Problem

The Science preset's `tool-result-pruner` row head/tail-truncates any `tool/result` over 8192 chars. A `skill` result is instructions the model is meant to follow in full, not disposable data: once a session grew large enough to trigger pruning, a truncated skill body silently dropped guardrails and workflow steps from its middle, and the model had no way to tell. The pruner had no way to exempt a result by its originating tool's name — only size drove the decision.

Two of the three bundled default Science skills (`scientific-visualization` 12.6KB, `scientific-writing` 13.0KB, `statistical-analysis` 20.0KB) already exceeded the threshold on their own, so the exemption alone was not sufficient: it stops truncation, but an oversized body still spends most of a session's context budget on one tool result every time the skill loads.

## Decision

### `exemptTools` Config field on compaction-tool-result-pruner

`ToolResultPruneConfig` gains `exemptTools: string[]` (default `[]`, validated as an array of strings at `resolveConfig`, and in the `static Config` zod schema). `pruneSession` resolves each snapshot candidate's originating `tool/call` name by call id (an O(n) map built once per prune pass, not a repeated per-result backward scan) and skips any candidate whose name is in `exemptTools` — the result is left in the surface untouched, never head/tail-truncated. An unresolvable call id (an orphan result with no matching call in the same snapshot) is treated as non-exempt, matching the pruner's existing "no name, no protection" default. This is a Config field, not a constant, per the repo's no-hardcoded-tunables rule: which tool names are exempt is a deployment/preset choice, not a package default.

The Science preset's `tool-result-pruner` row sets `exemptTools: [skill]` — `'skill'` is `dsh-tool-skill`'s registered tool name (`packages/skill/tool-skill/src/index.ts`). This is preset policy, not a package default: a different preset composing the same pruner package makes its own choice.

### Bundled Science skill bodies rewritten to fit under the threshold

The exemption stops truncation but does nothing about a body already larger than the threshold spending most of a session's context on one load. Each bundled `SKILL.md`'s body (`apps/desktop/resources/skills/{scientific-visualization,scientific-writing,statistical-analysis}/SKILL.md`) is rewritten to fit under 8000 bytes — below the preset's 8192-char pruner threshold with margin, and asserted by `bundled-skills.spec.ts` against the parsed post-frontmatter `content` field, the same field a `skill` tool result carries.

The rewrite keeps `name` unchanged (asserted elsewhere in `bundled-skills.spec.ts`) and every non-negotiable guardrail and workflow step, either inline as a short imperative bullet/numbered step or moved into that skill's own `references/*.md` and linked by path — nothing is deleted from a skill as a whole, only the always-loaded body shrinks. `description` becomes 1-2 trigger sentences with appended Chinese trigger terms, matching how the Science agent's `skill` tool actually selects a candidate. Tool-specific instructions that assumed a shell or `Write`/`Edit` (the Science agent has a read-only workspace plus `run_python`/`run_r`) are rewritten to name the tools the agent actually has. `scientific-visualization`'s `allowed-tools` frontmatter line is dropped: `skill-filesystem`'s frontmatter parser (`packages/skill/skill-filesystem/src/index.ts`, `parseSkillFile`) only reads `name`, `description`, `whenToUse`, the invocation-policy keys, and `metadata` — `allowed-tools` was never read by the harness.

`SOURCES.md`'s policy statement changes from "copied verbatim" to: `SKILL.md` bodies are locally rewritten for the model's context budget and the Science agent's tool set; `references/`, `scripts/`, and `assets/` stay verbatim; the re-copy procedure re-applies the body rewrite against the new upstream body and records the upstream commit. This supersedes the prior all-verbatim statement for `SKILL.md` specifically — upstream commit and license lines are unchanged.

### Test coverage

`compaction-tool-result-pruner`'s spec covers an exempt tool result left untouched, a non-exempt result pruned, an unknown call id treated as non-exempt, and `exemptTools` config rejecting a non-string entry. `bundled-skills.spec.ts` gains an assertion that every bundled skill's `content` is `<=8000` chars and strictly under the preset's `8192`-char pruner threshold (named and commented in the test, referencing the preset row) — the invariant the `exemptTools: [skill]` exemption relies on: the exemption only matters because the body already fits in one piece.

## Alternatives considered

**Raise the pruner threshold instead of exempting or shrinking.** Rejected: the threshold protects every tool result in the session, not just skill bodies; raising it globally would let an oversized non-skill result (a large file read, a verbose tool error) through untruncated too, for no reason connected to the actual problem.

**Exempt only by size (skip pruning any result already under some smaller cutover), not by tool name.** Rejected: a large non-skill result under that cutover would also escape pruning by accident, and the exemption would say nothing about *why* a result is protected. Naming the tool makes the policy legible in the preset's own config and auditable independently of any one result's size.

**Keep skill bodies at their original size and rely on the exemption alone.** Rejected as insufficient on its own (see Problem): an un-pruned but still-oversized body still spends most of a session's budget on one load every time the skill fires, which is the actual context-budget problem this note addresses, not just the truncation risk.

## Consequences

A `skill` result is never truncated regardless of size, in any preset that opts in via `exemptTools`. The Science preset's three bundled default skills each fit under the pruner threshold with margin even before the exemption applies, so the exemption is currently a second line of defense for these three skills, not their only protection — it becomes load-bearing the moment a skill body (bundled or user-provided) exceeds the threshold on its own. No session event, tool schema, or model-visible field beyond skill body wording changes; no keyless snapshot fixture references the Science persona, bundled skill text, or the pruner's config, so none needed refreshing for this change.
