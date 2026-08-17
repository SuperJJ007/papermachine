# Agent Note: DSH Science v0.1 rc.7 基线迁移

Status: proposed

[English](2026-08-17-dsh-science-v01-rc7-rebaseline.md) | 中文

## Problem

自 [R0](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) 起，DSH Science 开发线就把官方 rc.5（`47f943859bef60e4160492346772ded9b24f765a`）当作固定基线来跟踪，这是刻意的设计：R0 拒绝持续跟随上游，以免第一版尚未成形时,已接受的 overlay 证据反复失效。上游打出了 `dsh-v0.1.0-rc.7` 标签（`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`），比 rc.5 标签多出 111 个提交,其中包括[`4366528a38`](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md)：注册一个 settings 命名空间即等于把它暴露出去，`settings.plugin.item` 也随之变成以命名空间为键的 slot，于是 `packages/host/apiproxy` 不再持有硬编码的暴露白名单，也不再有 `settings-not-exposed` 错误码。

proposed 状态的 [R6 settings 与 Details](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md) 计划的第三个检查点 R6c，其目标仍是那个已被删除的架构：一个 Science settings 页面，只有当 `science-runtime` 加入某个本 Science 开发线并不拥有的包内部的白名单后才可达。若把 R6c 原样落地在 rc.5 上，要么在本开发线内 fork `api-proxy` 的暴露清单，要么请求一个共享包的所有者在上游已经构建出通用机制之前，先为 Science 单独承载一条清单项。两个选项都比直接采用上游已通用化的机制成本更高，而 R6a 与 R6b——两个不涉及 settings 暴露的检查点——都不依赖于自己落在哪个基线之上。

## Proposal

把 `upstream/master` 在精确的 rc.7 标签处合并进 `codex/science-v01-r3-science-tools-plan`——该分支与 rc.7 的合并基点正是本开发线原本跟踪的那个精确 rc.5 标签——并把结果落地为 `codex/science-v01-rc7-rebaseline`。这仅是一次源码基线迁移：不改变任何 Science 产品行为，同一改动中也不实现 R6c。

合并产生两处冲突，均为机械性冲突：

- `packages/host/apiproxy/src/api-proxy.ts`——我们把 `referencedImage`/`imageInEvent`/`imageBlockIn` 移入 `@deepseek-ai/dsh-session-attachment-index`,与上游删除 `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES` 及 `settings-not-exposed`，是同一文件里两处互不相干的改动；两侧删除均保留，不再使用的 `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` 导入被去掉，我们的 `PresetNotCopyableError` 保留。
- `scripts/doc-budgets.manifest.json`——我们的 `".agents/AGENTS.md": 160` 条目与上游为合并后根文件提高的 `"AGENTS.md": 1950` 上限（约 1929 词）,是同一份 manifest 里两条互不相干的条目；两者均保留。

本 fork 新增的五个包（`packages/science/science-runtime`、`packages/science/science-session`、`packages/science/tool-science`、`packages/client/ui-science`、`packages/session/session-attachment-index`）从 `0.1.0-rc.5` 升到 `0.1.0-rc.7`，使 dsh release family 保持单一版本号，依据是 [`scripts/release/families.ts`](../../../../scripts/release/families.ts)。

R6a（`f5bbcf0ff2`——Runtime settings 归属）与 R6b（`bb911b9c0c`——通用 Details 路由）已作为提交存在于迁移前的分支尖端，无需重新设计：`installSettingsSection` 与 `settings.plugin.item` slot 的注册路径在 rc.5 时就已存在，rc.7 未触碰 `packages/client/ui-conversation` 的 Details 列或 settings seam 的读写 API（已通过在 rc.5 与 rc.7 标签之间比较 `packages/settings` 与 `packages/client/ui-conversation` 确认），两个提交都无冲突地随合并延续下来。它们的 tree 身份发生了变化：任何对 R6a/R6b 的验收或证据评审都必须针对迁移后的提交,而非上面列出的迁移前 SHA，因为它们所在的基线已不再是 rc.5 标签。

## Alternatives considered

**留在 rc.5 上，fork `api-proxy` 的暴露清单。** 已拒绝，因为这会让 Science 开发线为了一个命名空间而接管一个共享通用包的 settings 暴露边界，造成与上游的分叉——这个分叉要么无限期存在，要么在下一次基线迁移时仍要被撤销。上游已经把同样的需求通用化了。

**等 R6c 上线之后再做基线迁移。** 已拒绝，因为 R6 note 中写下的 R6c settings 表层计划，目标正是 rc.7 删除的那套白名单架构。若照 rc.5 实现，就会先上线一个以白名单成员资格为键的 `settings.section` 页面，然后在下一次基线迁移后立刻要重新设计成以命名空间为键的 `settings.plugin.item` 卡片——为同一个产品表层付两次设计与实现成本。先做基线迁移，意味着 R6c 只需针对那套上线后仍然是当前机制的架构设计与构建一次。

**只把 `4366528a38` cherry-pick 到 rc.5 上，而不做完整的基线迁移。** 已拒绝，因为该提交无法从它所处的 rc.5→rc.7 settings 与 Client 历史中（`packages/client/ui-settings-plugins/src/client/tab-store.ts` 及其调用方）孤立出来；只 cherry-pick 一个上游提交而不带上它周边的历史，会让本开发线永远无法再做一次真正的完整迁移而不必两次解决同样的冲突——一次为了 cherry-pick，一次为了最终的完整合并。

## Acceptance criteria

- 基线迁移分支与 `upstream/master`（`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`）的合并基点，恰好是 rc.5 标签 `47f943859bef60e4160492346772ded9b24f765a`；不跳过或压缩任何上游历史。
- 两处冲突的解决都保留了双方各自的改动（没有任何上游删除或 Science 开发线新增被静默丢弃），并在合并提交正文中记录确切的解决方式。
- 双方都触碰到的每一份生成产物（`gen-client-catalog`、`gen-cordis-api`、`gen-cordis-catalog`、`gen-tool-catalog`、`gen-config-catalog`、`gen-persistence-catalog`、`gen-module-graph`、`gen-third-party-notices`）都重新生成，且与已提交的树零差异。
- `typecheck`、`lint`、`build`、`doc-sync` 与仓库单元测试套件（`test`）在合并提交上通过。`hygiene` 除 `rescope-vendor:check` 外通过；该项的失败经证明是迁移前既有的、与 rc.5 合并基点上同一检查结果逐条一致的问题，在一次性对照 worktree 中确认。
- `test:snapshot` 与 `test:web` 通过，且没有任何 Science fixture 需要手改期望值；任何被重新录制的 fixture 都通过其文档化的刷新命令重新录制，并对差异逐一评审，绝不手改。
- `git diff --check` 在完整合并范围内干净。
- 在没有密钥或隔离验收环境的情况下，`test:e2e` 与真实 Python/R Science 验收在本次基线迁移自己的证据记录中被明确标为 `NOT-RUN`；依赖它们的后续检查点重新运行，而非继承这次的通过结果。

## Risks

本次基线迁移只是一个源码层面的检查点：它本身并不把 R6a 或 R6b 作为已评审检查点验收，除本 Note 与本次迁移自身的证据记录外，也不为二者产生任何 dated evidence。未来对 R6a/R6b 的验收仍需针对迁移后的树单独评审。

本开发线此后新增的每一个 settings 命名空间，都是"注册即暴露"，不只是 `science-runtime`。已上线的 `pythonPrefix`/`rPrefix` 字段已经使用 `role('secret')`，因此今天没有任何路径值会跨越协议；但未来任何新增的 Science settings 字段都必须显式携带同样的 role——已经没有白名单能在遗漏标注时兜底把一个未标注字段挡在浏览器之外。

真实 Python/R Conda 验收与 Desktop/release 各层不因本次基线迁移而重新验证；它们保持与迁移前完全相同的 `NOT-RUN` 状态，本 Note 中的任何内容都不应被解读为把 R2 或 R5 的真实验收证据延伸到 rc.7 树上。
