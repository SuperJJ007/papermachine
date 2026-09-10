# Agent Note: Replant upstream patch ledger

Status: implemented

English | [中文](2026-09-09-replant-upstream-patch-ledger.zh.md)

## Problem

Following upstream rc releases after the 0.1.5 replant requires an inventory of retained patches and their replacement conditions. Migration PLAN §2.4 requires attribution, size, and upstream status for every patch.

## Decision

This inventory covers `ce76a86204..6528088e9f8c579024124add2642cde5a062ff16`. Each row measures the complete listed package or file delta, including tests, documentation, and generated files; source-only counts are identified separately. Counts come from `git diff --stat ce76a86204..6528088e9f8c579024124add2642cde5a062ff16 -- <path>`, with additions/deletions totaled from the same range’s `--numstat`. B denotes the 2026-09-09 migration research `B-upstream-patch-audit.md`; the watermark KEEP row is RE-APPLY under PLAN §2.3, and attachment P2.5 redesigns onto upstream File APIs. Owned Science packages are outside the upstream count; owned session-attachment-index is listed separately for its V3 adaptation.

| Package or file | +/− | B row and verdict | Upstream alternative | Submitted upstream | Decision owner |
| --- | --- | --- | --- | --- | --- |
| `packages/api/remotes` | +6/−3 | B §2 api/remotes; RE-APPLY | Public Remote mount exists; Science registration required | Not submitted | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md) |
| `packages/api/settings-controller` | +1/−0 | B §3 settings + B §1 ui-settings; RE-APPLY | No effective values; wire secrets exist | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/attachment/attachment` | +17/−2 | B §3 attachment + attachment-local; REDESIGN | FileAttachmentRef replaces Text family; verbatim admission absent | Not submitted | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md) |
| `packages/attachment/attachment-local` | +71/−4 | B §3 attachment + attachment-local; REDESIGN | FileAttachmentRef replaces Text family; verbatim admission absent | Not submitted | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md) |
| `packages/boot/app-boot` | +4/−0 | B: no row; PLAN P2.9 / §7; RE-APPLY (approved exception / 已批准例外) | Unplanned, required by P2.9, listed in PLAN §7; no upstream preset/profile | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/bundle/headless` | +19/−10 | B: no row; PLAN P2.9 / §7; RE-APPLY (approved exception / 已批准例外) | Unplanned, required by P2.9, listed in PLAN §7; no upstream preset/profile | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/connection` | +2/−0 | B §1 client/connection; REDESIGN | Generated Remote assembly replaces proxy fixtures | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/locale` | +2/−1 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-agent-preset` | +49/−45 | B §1 ui-agent-preset; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-permission-presets` | +2/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-settings` | +13/−5 | B §1 ui-settings; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-settings-models` | +36/−30 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-settings-plugins` | +3/−3 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/client/ui-theme` | +1/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/compaction/compaction-tool-result-pruner` | +98/−7 | B §3 compaction-tool-result-pruner exemptTools; RE-APPLY | No exemptTools; P2 optional-chain defect fixed | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/core/agent-loop` | +35/−2 | B §3 agent-loop; PLAN §7.1; RE-APPLY | No retry reinjection; source delta +5/−0 | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/e2b/e2b` | +4/−0 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md) |
| `packages/e2b/subprocess-e2b` | +109/−17 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md) |
| `packages/experimental/webworker-runtime` | +3/−0 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/extensions/tool-cordis` | +90/−27 | B §3 extensions/tool-cordis; REGENERATE | Upstream generator retained | Not submitted | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md) |
| `packages/fs/tool-fs` | +435/−47 | B §3 tool-fs; RE-APPLY | No read-only package entry | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/fs/tool-fs-search` | +5/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/llm/plugin-package-inventory-deepseek` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/lsp/lsp-stdio` | +1/−0 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/mcp/mcp-client` | +411/−47 | B §3 mcp-client; RE-APPLY | No deployment tool curation | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/preset/agent-presets` | +178/−68 | B §3 agent-presets; RE-APPLY | No copyable policy | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/sandbox/sandbox` | +231/−2 | B §3 sandbox shared classification; RE-APPLY | No shared classifier; shell copies removed | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/sandbox/sandbox-local` | +13/−7 | B §3 sandbox + subprocess; RE-APPLY | Existing confinement retained; env relay absent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md) |
| `packages/sandbox/sandbox-windows-acl` | +179/−3 | B §3 sandbox-windows-acl; RE-APPLY | No windowless console initialization | Not submitted | [windowless-acl-runner-console](../bug-fix/2026-09-09-windowless-acl-runner-console.md) |
| `packages/session/session-attachment-index` | +50/−34 | B §2 file-reference policy (owned package); REDESIGN | V3 carrier scanning replaces Text references | Not submitted | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md) |
| `packages/session/session-projection` | +34/−11 | B §3 session-projection watermark KEEP; RE-APPLY | stateSchema exists; watermark check absent | Not submitted | [projection-checkpoint-watermark-admission](../architecture/2026-09-09-projection-checkpoint-watermark-admission.md) |
| `packages/settings/settings` | +89/−3 | B §3 settings + B §1 ui-settings; RE-APPLY | No effective values; wire secrets exist | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/shell/bash-local` | +6/−5 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/shell/bash-sandbox` | +31/−155 | B §3 sandbox shared classification; RE-APPLY | No shared classifier; shell copies removed | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/shell/pwsh-local` | +6/−3 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/shell/pwsh-sandbox` | +17/−136 | B §3 sandbox shared classification; RE-APPLY | No shared classifier; shell copies removed | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/shell/tool-bash-persistent` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/shell/tool-pwsh-persistent` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/subagent/subagent-acp` | +14/−10 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/subagent/subagent-claude-code` | +3/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/subagent/subagent-codex` | +3/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/subprocess/subprocess` | +59/−7 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md) |
| `packages/subprocess/subprocess-local` | +159/−24 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.md) |
| `packages/terminal/terminal-bash` | +17/−10 | B §3 terminal-bash; RE-APPLY | No confined runner env relay | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md) |
| `packages/terminal/tool-terminal` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `packages/test-support/client-runtime` | +2/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | No effective/copyable snapshot equivalent | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `packages/test-support/session-snapshot` | +2/−2 | B §3 subprocess / companion call sites; RE-APPLY | No target-environment or observation equivalent | Not submitted | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.md) |
| `scripts/gen-cordis-catalog.ts` | +6/−0 | B §4 scripts catalog registration; RE-APPLY | Existing generator/classifier; named Science registration | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `scripts/verify-application-entrypoints.ts` | +4/−0 | B §4 scripts test-driver classification; RE-APPLY | Existing generator/classifier; named Science registration | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `scripts/verify-application-entrypoints.spec.ts` | +10/−0 | B §4 scripts classification rejection test; RE-APPLY | Existing generator/classifier; named Science registration | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `scripts/check-workspace-constraints.ts` | +5/−0 | B §4 scripts publication payload registration; RE-APPLY | Existing per-package exact list; required payload registration | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |
| `scripts/check-workspace-constraints.spec.ts` | +21/−0 | B §4 scripts publication payload rejection tests; RE-APPLY | Existing per-package exact list; required payload registration | Not submitted | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md) |

D9 keeps `effective` required: every settings snapshot carries the effective value, restart-scoped owners retain the value read at registration, and clients need no undefined branch. Changes to approximately 20 upstream client fixtures are an accepted rc conflict cost. The complete client-test delta below also includes two owned ui-science files, which are not upstream patches:

- `packages/client/locale/tests/apply.client.spec.ts`
- `packages/client/locale/tests/document-language.client.spec.ts`
- `packages/client/ui-agent-preset/tests/apply.client.spec.ts`
- `packages/client/ui-agent-preset/tests/section-store.client.spec.ts`
- `packages/client/ui-agent-preset/tests/section.client.spec.tsx`
- `packages/client/ui-agent-preset/tests/settings-store.client.spec.ts`
- `packages/client/ui-permission-presets/tests/permission-presets-row.client.spec.tsx`
- `packages/client/ui-permission-presets/tests/settings-store.client.spec.ts`
- `packages/client/ui-science/tests/ScienceSettingsCard.client.spec.tsx`
- `packages/client/ui-science/tests/settings-card-controller.client.spec.ts`
- `packages/client/ui-settings-models/tests/apply.client.spec.ts`
- `packages/client/ui-settings-models/tests/components.client.spec.tsx`
- `packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx`
- `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx`
- `packages/client/ui-settings-models/tests/store.client.spec.ts`
- `packages/client/ui-settings-models/tests/welcome-notice.client.spec.tsx`
- `packages/client/ui-settings-models/tests/welcome-store.client.spec.ts`
- `packages/client/ui-settings-plugins/tests/apply.client.spec.ts`
- `packages/client/ui-settings-plugins/tests/stores.client.spec.ts`
- `packages/client/ui-settings/tests/settings-mirror.client.spec.ts`
- `packages/client/ui-settings/tests/settings-scope.client.spec.ts`
- `packages/client/ui-theme/tests/apply.client.spec.ts`

D10 removes the owned Science `workspaceFiles`/`workspaceFile` methods; their pre-removal commit is `1089ef24a1`. File tabs use upstream `api/workspace-files` and `ui-sidebar-files`, neither disabled by the Science overlay. Minimal additional code is warranted only if P4 demonstrates missing dotfile/node_modules filtering or mediaType support. `textAttachmentByteLimit` continues to bound attachment previews, defaulting to 2 MiB. D11 authorizes against the session cwd’s project: cross-session reads within it are permitted, missing cwd is denied, and project-version lookup covers the run-inputs branch.

Published packages register secondary entries, shared chunks, kernel assets, and presets through the existing `packageFileExtras` mechanism, and all four package `files` lists match exactly. Merely shrinking `files` would remove public entrypoints and runtime resources from installed packages. Named payload registrations preserve those capabilities without weakening global rules. Each of the four packages rejects both missing entries and additional unowned entries.

## rc.1 integration

The rc.1 composition retains the Science Remote mount alongside session feedback. MCP discovery rejects repeated continuation cursors before replacing the curated tool generation; include/exclude/rename/describe remain deployment-owned. The Science preset retains its own artifact events, versioned reads and edits; upstream file delivery does not replace those identities.

The [native-sidebar decision](../architecture/2026-09-10-science-native-sidebar.md) owns the client additions: an independent Science Library page, session-addressed navigation, layout-width persistence through owner-defined JSON projection and validation, and synchronous adoption of restored resource occurrences. Versioned browser preference keys discard the earlier layout representation. Sidebar preferences validate the full node tree, tab ownership, active references, split ratios, floating rectangles and identity counters. Undo operations remain page-local. Blank Sessions retain the native header corner control; the cancelled left-library action requires no additional navigation slot. The public controller already provides cross-session tab navigation, so redundant ISidebarRight declarations are removed. The ordinary workspace document viewer uses the upstream documentpreview package.

## Alternatives considered

**Retain the workspace file Remotes.** Upstream provides file browsing and reads; duplicating them adds maintenance cost. D10 removes them while retaining the condition for minimal additions.

**Optional effective.** Introducing undefined branches solely to reduce fixture conflicts contradicts D9’s always-present effective settings value.

## Consequences

The ledger supplies scope and decision ownership for reviewing rc patches without replacing each Note’s rationale. Seven existing Notes retain independent authorization, environment, lifecycle, or configuration decisions; this ledger cross-links them without archiving or rewriting their decisions. Generated outputs, script registrations, and caller fixtures remain coupled to their owning patches. Actual commands, unexecuted checks, and phase ownership are recorded in the [P2 execution record](../../../migrations/0.1.5/P2.md).

## Upstream feedback

Migration PLAN §7 lists the generic retry-context fix (item 1, implemented in five source lines), windowless ACL console initialization (item 2), and the upstream optional-chain issue (item 6). Item 7 adds the headless driver's default-preset mount and durable `meta.agentPreset`, plus `subprocess-local/tests/spawn-runner.spec.ts`'s ambient `NoDefaultCurrentDirectoryInExePath` assumption. All remain unsubmitted; this closeout neither edits PLAN nor sends upstream messages. The spawn-runner test can be checked with that ambient variable absent while preserving its expected child-process behavior.
