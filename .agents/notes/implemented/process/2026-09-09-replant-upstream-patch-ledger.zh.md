# Agent Note: 移栽上游补丁台账

Status: implemented

[English](2026-09-09-replant-upstream-patch-ledger.md) | 中文

## 问题

移栽到 0.1.5 后，跟进上游 rc 需要逐项识别仍须维护的补丁及其替代条件。迁移 PLAN §2.4 要求每项补丁留存来源、规模和上游状态。

## Decision

本表记录 `ce76a86204..6528088e9f8c579024124add2642cde5a062ff16`，每行按所列包或文件统计完整差异（含测试、文档及生成文件），不把源码行数与完整差异混用。数据来自 `git diff --stat ce76a86204..6528088e9f8c579024124add2642cde5a062ff16 -- <path>`，+/− 由同范围 `--numstat` 汇总。B 指 2026-09-09 迁移研究的 `B-upstream-patch-audit.md`；KEEP 水位项按 PLAN §2.3 落为 RE-APPLY，附件项按 P2.5 使用上游 File API 重设计。自有 Science 包不算上游补丁；自有 session-attachment-index 单列以记录其 V3 适配。

| 包或文件 | +/− | B 对应行与判定 | 上游替代 | 已提上游 | 决定记录 |
| --- | --- | --- | --- | --- | --- |
| `packages/api/remotes` | +6/−3 | B §2 api/remotes; RE-APPLY | 已有公共 Remote 挂载，须登记 Science | 未提 | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md) |
| `packages/api/settings-controller` | +1/−0 | B §3 settings + B §1 ui-settings; RE-APPLY | 无 effective 值，wire 已有 secrets | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/attachment/attachment` | +17/−2 | B §3 attachment + attachment-local; REDESIGN | FileAttachmentRef 替代 Text 族，缺原字节准入 | 未提 | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md) |
| `packages/attachment/attachment-local` | +71/−4 | B §3 attachment + attachment-local; REDESIGN | FileAttachmentRef 替代 Text 族，缺原字节准入 | 未提 | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md) |
| `packages/boot/app-boot` | +4/−0 | B: no row; PLAN P2.9 / §7; RE-APPLY (approved exception / 已批准例外) | 计划外、P2.9 必需、已列入 PLAN §7；上游无对应 preset/profile | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/bundle/headless` | +19/−10 | B: no row; PLAN P2.9 / §7; RE-APPLY (approved exception / 已批准例外) | 计划外、P2.9 必需、已列入 PLAN §7；上游无对应 preset/profile | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/connection` | +2/−0 | B §1 client/connection; REDESIGN | 生成 Remote 装配替代代理 fixture | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/locale` | +2/−1 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-agent-preset` | +49/−45 | B §1 ui-agent-preset; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-permission-presets` | +2/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-settings` | +13/−5 | B §1 ui-settings; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-settings-models` | +36/−30 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-settings-plugins` | +3/−3 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/client/ui-theme` | +1/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/compaction/compaction-tool-result-pruner` | +98/−7 | B §3 compaction-tool-result-pruner exemptTools; RE-APPLY | 无 exemptTools，已修 P2 可选链错误 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/core/agent-loop` | +35/−2 | B §3 agent-loop; PLAN §7.1; RE-APPLY | 无重试重注入，源码改动 +5/−0 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/e2b/e2b` | +4/−0 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md) |
| `packages/e2b/subprocess-e2b` | +109/−17 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md) |
| `packages/experimental/webworker-runtime` | +3/−0 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/extensions/tool-cordis` | +90/−27 | B §3 extensions/tool-cordis; REGENERATE | 使用上游生成器 | 未提 | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md) |
| `packages/fs/tool-fs` | +435/−47 | B §3 tool-fs; RE-APPLY | 无只读包入口 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/fs/tool-fs-search` | +5/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/llm/plugin-package-inventory-deepseek` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/lsp/lsp-stdio` | +1/−0 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/mcp/mcp-client` | +411/−47 | B §3 mcp-client; RE-APPLY | 无部署级工具筛选 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/preset/agent-presets` | +178/−68 | B §3 agent-presets; RE-APPLY | 无 copyable 策略 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/sandbox/sandbox` | +231/−2 | B §3 sandbox shared classification; RE-APPLY | 无公共分类器，删除 shell 副本 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/sandbox/sandbox-local` | +13/−7 | B §3 sandbox + subprocess; RE-APPLY | 保留已有约束，缺 env 传递 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md) |
| `packages/sandbox/sandbox-windows-acl` | +179/−3 | B §3 sandbox-windows-acl; RE-APPLY | 无无窗口控制台初始化 | 未提 | [windowless-acl-runner-console](../bug-fix/2026-09-09-windowless-acl-runner-console.zh.md) |
| `packages/session/session-attachment-index` | +50/−34 | B §2 file-reference policy (owned package); REDESIGN | V3 载体扫描替代 Text 引用 | 未提 | [science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md) |
| `packages/session/session-projection` | +34/−11 | B §3 session-projection watermark KEEP; RE-APPLY | 已有 stateSchema，缺水位检查 | 未提 | [projection-checkpoint-watermark-admission](../architecture/2026-09-09-projection-checkpoint-watermark-admission.zh.md) |
| `packages/settings/settings` | +89/−3 | B §3 settings + B §1 ui-settings; RE-APPLY | 无 effective 值，wire 已有 secrets | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/shell/bash-local` | +6/−5 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/shell/bash-sandbox` | +31/−155 | B §3 sandbox shared classification; RE-APPLY | 无公共分类器，删除 shell 副本 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/shell/pwsh-local` | +6/−3 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/shell/pwsh-sandbox` | +17/−136 | B §3 sandbox shared classification; RE-APPLY | 无公共分类器，删除 shell 副本 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/shell/tool-bash-persistent` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/shell/tool-pwsh-persistent` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/subagent/subagent-acp` | +14/−10 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/subagent/subagent-claude-code` | +3/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/subagent/subagent-codex` | +3/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/subprocess/subprocess` | +59/−7 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md) |
| `packages/subprocess/subprocess-local` | +159/−24 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md), [managed-cooperative-interruption](../architecture/2026-09-09-managed-cooperative-interruption.zh.md) |
| `packages/terminal/terminal-bash` | +17/−10 | B §3 terminal-bash; RE-APPLY | 无受约束 runner env 传递 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md) |
| `packages/terminal/tool-terminal` | +1/−1 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `packages/test-support/client-runtime` | +2/−0 | B §1 settings / copyable fixture consequences; RE-APPLY | 无 effective/copyable 快照替代 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `packages/test-support/session-snapshot` | +2/−2 | B §3 subprocess / companion call sites; RE-APPLY | 无目标环境或观测替代 | 未提 | [subprocess-target-environment-base](../architecture/2026-09-09-subprocess-target-environment-base.zh.md), [subprocess-observation-facts](../architecture/2026-09-09-subprocess-observation-facts.zh.md) |
| `scripts/gen-cordis-catalog.ts` | +6/−0 | B §4 scripts catalog registration; RE-APPLY | 已有生成器或分类规则，补 Science 登记 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `scripts/verify-application-entrypoints.ts` | +4/−0 | B §4 scripts test-driver classification; RE-APPLY | 已有生成器或分类规则，补 Science 登记 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `scripts/verify-application-entrypoints.spec.ts` | +10/−0 | B §4 scripts classification rejection test; RE-APPLY | 已有生成器或分类规则，补 Science 登记 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `scripts/check-workspace-constraints.ts` | +5/−0 | B §4 scripts publication payload registration; RE-APPLY | 已有逐包精确清单，登记必需发布载荷 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |
| `scripts/check-workspace-constraints.spec.ts` | +21/−0 | B §4 scripts publication payload rejection tests; RE-APPLY | 已有逐包精确清单，登记必需发布载荷 | 未提 | [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md) |

D9 保持 `effective` 必填：每个设置快照都携带生效值，重启生效的所有者保留注册时读取的值，客户端无需引入 undefined 分支。约 20 个上游客户端 fixture 的改动是接受的 rc 冲突成本；下列完整客户端测试差异包含两个自有 ui-science 文件，不把它们算作上游补丁：

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

D10 删除 Science 自有 `workspaceFiles`/`workspaceFile`，删除前 commit 为 `1089ef24a1`。文件标签使用上游 `api/workspace-files` 与 `ui-sidebar-files`；Science overlay 未禁用这两个插件。只有 P4 实测证明缺少 dotfile/node_modules 过滤或 mediaType 时，才以最小代码补足。`textAttachmentByteLimit` 继续约束附件预览，默认 2 MiB。D11 以会话 cwd 所属项目授权；同项目跨会话可读，cwd 缺失拒绝，run-inputs 分支由项目版本查询覆盖。

发布包通过现有 `packageFileExtras` 登记次级入口、共享 chunk、内核 assets 和 preset，并要求四个包的 `files` 与其精确匹配。只缩减 `files` 会让已安装包丢失公开入口及运行资源；登记补充载荷保留这些能力而不放宽全局规则。四个包分别验证缺少任意条目或加入未归属条目都会拒绝。

## 考虑过的替代方案

**保留工作区文件 Remote。** 上游提供文件浏览与读取，复制整套实现扩大维护成本；按 D10 删除，保留必要时最小补足的条件。

**可选 effective。** 只为减少 fixture 冲突而引入客户端 undefined 分支，不符合设置始终有生效值的 D9 决定。

## Consequences

台账为逐项复核 rc 补丁提供范围和决定归属，不替代各 Note 的理由。七篇已有 Note 继续拥有独立的权限、环境、生命周期或配置决定；本台账只交叉链接，不归档或改写其决定。生成结果、脚本登记和调用点 fixture 随其所属补丁一起维护。真实命令结果、未执行项与阶段归属记录在 [P2 执行记录](../../../migrations/0.1.5/P2.md)。

## 上游回馈

迁移 PLAN §7 列出通用重试上下文修复（第 1 项，以五行源码落地）、无窗口 ACL 控制台初始化（第 2 项）及上游可选链问题（第 6 项）。第 7 项补充 headless 驱动挂载默认 preset 并持久记录 `meta.agentPreset`，以及 `subprocess-local/tests/spawn-runner.spec.ts` 对宿主 `NoDefaultCurrentDirectoryInExePath` 的假设。以上均未提交上游；本次收尾不修改 PLAN，也不发送上游消息。spawn-runner 测试可在移除该宿主变量后验证，保持其预期子进程行为。
