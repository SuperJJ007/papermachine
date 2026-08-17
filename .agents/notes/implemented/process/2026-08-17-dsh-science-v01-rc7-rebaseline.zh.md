# Agent Note: DSH Science v0.1 rc.7 基线迁移

Status: implemented

[English](2026-08-17-dsh-science-v01-rc7-rebaseline.md) | 中文

## Problem

自 [R0](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) 起，DSH Science 开发线就把官方 rc.5（`47f943859bef60e4160492346772ded9b24f765a`）当作固定基线来跟踪，这是刻意的设计：R0 拒绝持续跟随上游，以免第一版尚未成形时，已接受的 overlay 证据反复失效。此后上游打出了 `dsh-v0.1.0-rc.7` 标签（`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`），比 rc.5 标签多出 111 个提交，其中包括 [`4366528a38`](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md)：注册一个 settings 命名空间即等于把它暴露出去，`settings.plugin.item` 也随之变成以命名空间为键的 slot，于是 `packages/host/apiproxy` 不再持有硬编码的暴露白名单，也不再有 `settings-not-exposed` 错误码。

proposed 状态的 [R6 settings 与 Details](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md) 计划的第三个检查点 R6c，其目标正是那次删除所移除的架构：一个 Science settings 页面，只有当 `science-runtime` 加入某个本 Science 开发线并不拥有的包内部的白名单后才可达。若把 R6c 原样落地在 rc.5 上，要么在本开发线内 fork `api-proxy` 的暴露清单，要么请求一个共享包的所有者在上游已经构建出通用机制之前，先为 Science 单独承载一条清单项。两个选项都比直接采用上游已通用化的机制成本更高，而 R6a 与 R6b——两个不涉及 settings 暴露的检查点——都不依赖于自己落在哪个基线之上。

## Decision

本开发线的基线是上游 rc.7。`upstream/master` 在精确的 rc.7 标签处被合并进原分支尖端 `bb911b9c0c`——两者的合并基点正是本开发线原本跟踪的那个精确 rc.5 标签——结果落地为 `codex/science-v01-rc7-rebaseline`（合并提交 `ecde1b09ff`）。这次基线迁移只改源码：不改变任何 Science 产品行为，同一改动中也不实现 R6c。

合并出现两处冲突，均为机械性冲突，其解决保留了双方的每一处改动：

- `packages/host/apiproxy/src/api-proxy.ts`——本开发线把 `referencedImage`/`imageInEvent`/`imageBlockIn` 移入 `@deepseek-ai/dsh-session-attachment-index`，与上游删除 `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES` 及 `settings-not-exposed`，是同一文件里两处互不相干的改动。两侧删除都保留，不再使用的 `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` 导入已去掉，本开发线的 `PresetNotCopyableError` 保留。
- `scripts/doc-budgets.manifest.json`——本开发线的 `".agents/AGENTS.md": 160` 条目与上游为合并后根文件提高的 `"AGENTS.md": 1950` 上限（约 1929 词），是同一份 manifest 里两条互不相干的条目，两者都保留。

本 fork 新增的五个包（`packages/science/science-runtime`、`packages/science/science-session`、`packages/science/tool-science`、`packages/client/ui-science`、`packages/session/session-attachment-index`）都带 `0.1.0-rc.7`，使 dsh release family 保持单一版本号，这是 [`scripts/release/families.ts`](../../../../scripts/release/families.ts) 的要求。

R6a（`f5bbcf0ff2`——Runtime settings 归属）与 R6b（`bb911b9c0c`——通用 Details 路由）无需重新设计：`installSettingsSection` 与 `settings.plugin.item` 的注册路径在 rc.5 时就已存在，rc.7 未触碰 `packages/client/ui-conversation` 的 Details 列，也未触碰 settings seam 的读写 API，两个提交都无冲突地随合并延续下来。它们的 tree 身份发生了变化，因此二者已评审的身份是迁移后的 head，而不是这里列出的迁移前 SHA。

## Verification

带日期的[基线迁移证据](../../../../docs/evidence/2026-08-17-dsh-science-v01-rc7-rebaseline.md)拥有全部命令、平台事实与结果；本 Note 只界定什么算已验证。

源码与文档各项 gate 在记录的 head 上直接通过：`typecheck`、`lint`、`build`、`doc-sync`、对完整合并范围的 `git diff --check`，以及双方都触碰到的每一个生成器的逐字节复现。`hygiene` 只在 `rescope-vendor:check` 处失败，其 26 项问题经一次性对照 worktree 证明与上游 rc.7 上同一检查的结果逐条一致——这是继承自上游的缺口，不是本次迁移引入的缺陷。

范围超出单个包的三个套件——`test`、`test:snapshot`、`test:web`——是按一条明示标准验证的，而不是按一次全绿的运行，因为每个套件都带有并非本开发线引入的失败。一处失败只有在对照修订上被证明集合一致、或其文件单独运行时不复现的情况下才被接受；证据逐条记录了每一处被接受的失败及其成因，且没有为达到该状态手改任何 fixture。今天有两条通道只满足该标准较弱的那一半：`test:snapshot` 与 `test:web` 的既有失败是依据单独重跑与更早的 [R5 记录](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md)论证的，而非依据在 rc.5 合并基点上的一次新对照运行。该对照被推迟，因为这两条通道都会驱动真实浏览器或触达 Host 的原生路径打开器，需要一台桌面空闲的机器。

对记录 head 的独立评审验收了 R6a、R6b 与本次基线迁移，并通过对全部 539 个上游改动文件的脚本化比对确认：合并没有复活任何上游删除，也没有丢失任何上游新增。`test:e2e` 与真实 Python/R Science 验收为 `NOT-RUN`；后续依赖其中任何一项的检查点都要重新运行，而不是从这里继承任何结果。

## Alternatives considered

**留在 rc.5 上，fork `api-proxy` 的暴露清单。** 已拒绝，因为这会让 Science 开发线为了一个命名空间而接管一个共享通用包的 settings 暴露边界，造成与上游的分叉——这个分叉要么无限期存在，要么在下一次基线迁移时仍要被撤销。上游已经把同样的需求通用化了。

**等 R6c 上线之后再做基线迁移。** 已拒绝，因为 R6 note 中写下的 R6c settings 表层计划，目标正是 rc.7 删除的那套白名单架构。若照 rc.5 实现，就会先上线一个以白名单成员资格为键的 `settings.section` 页面，然后在下一次基线迁移后立刻要重新设计成以命名空间为键的 `settings.plugin.item` 卡片——为同一个产品表层付两次设计与实现成本。先做基线迁移，意味着 R6c 只需针对那套上线后仍然是当前机制的架构设计与构建一次。

**只把 `4366528a38` cherry-pick 到 rc.5 上，而不做完整的基线迁移。** 已拒绝，因为该提交无法从它所处的 rc.5→rc.7 settings 与 Client 历史中（`packages/client/ui-settings-plugins/src/client/tab-store.ts` 及其调用方）孤立出来；只 cherry-pick 一个上游提交而不带上它周边的历史，会让本开发线永远无法再做一次真正的完整迁移而不必两次解决同样的冲突——一次为了 cherry-pick，一次为了最终的完整合并。

## Consequences

R6c 只需针对通用机制设计与构建一次，而 `api-proxy` 的暴露行为仍归上游所有。代价付在身份上，而不是代码上：R6a 与 R6b 的提交如今所处的树与它们落地时已不相同，而带日期的 R1–R5 证据绑定的是迁移前的 SHA，因此没有任何更早的记录能凭继承延伸到这棵树上。R6c 的实现基座是 [R6 note](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md) 身份表中记录的那个已验收的迁移后 head。

本开发线此后新增的每一个 settings 命名空间都是"注册即暴露"，不只是 `science-runtime`。已上线的 `pythonPrefix`/`rPrefix` 字段已经使用 `role('secret')`，而 seam 会同等地对解析值、组合基座与用户层做脱敏，因此今天没有任何路径值会跨越协议。未来任何新增的 Science settings 字段都必须显式携带同样的 role：已经没有白名单能在遗漏标注时兜底把一个未标注字段挡在浏览器之外。

上面那次被推迟的对照运行是一项尚未关闭的验证事项：在它运行之前，`test:snapshot` 与 `test:web` 的失败只是被归因，而非在某个基线修订上被证明为既有。

真实 Python/R Conda 验收与 Desktop、release 各层不在此处重新验证。它们保持与迁移前完全相同的 `NOT-RUN` 状态，本 Note 中的任何内容都不把 R2 或 R5 的真实验收证据延伸到 rc.7 树上。
