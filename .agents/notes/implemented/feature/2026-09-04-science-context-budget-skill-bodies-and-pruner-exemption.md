# Agent Note: Science context budget — exempt skill pruning, shrink bundled skill bodies

Status: implemented

English | [中文](2026-09-04-science-context-budget-skill-bodies-and-pruner-exemption.zh.md)

## Problem

Instruction-bearing skill results can be removed by ordinary result pruning, but retaining every large result would exhaust context.

## Decision

Science deployment policy exempts the named skill-loading tools from ordinary result pruning and records the selected exempt tool names in effective policy. Skill bodies themselves stay concise, moving detailed references into separately read resources. Exemption and body-size control solve different problems: one preserves instructions already read, the other reduces their initial cost.

## Alternatives considered

**Raise the global pruning threshold.** Large data and log outputs would remain alongside the instructions.

**Exempt by result size or guessed content.** Size does not identify instructional ownership and content heuristics can misclassify arbitrary output.

**Rely on exemption instead of trimming skills.** A retained oversized instruction still consumes the same context.

## Consequences

Tool-name policy is explicit and configurable rather than an implicit special case in the generic pruner. Shortening a skill must preserve its workflow and links to necessary detail; exemption does not make every resource body fit the context budget.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md); [science-context-churn-and-run-directory-guidance](../bug-fix/2026-09-04-science-context-churn-and-run-directory-guidance.md).
