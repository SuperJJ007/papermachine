# Agent Note：replant rc.2 私有补丁台账

Status: implemented

[English](2026-09-11-replant-rc2-patch-ledger.md) | 中文

## 问题

[rc.1 补丁台账](2026-09-09-replant-upstream-patch-ledger.zh.md) 度量的是一个已冻结的历史切片 `ce76a86204..42727936501003d214001ef74013a511878c35ae`。那些数字对该切片成立，但它们不是分支相对上游的持续增量；而且那份台账是已实现记录，其数字不能就地改写。rc.2 merge-forward 之后，分支需要一份以它当前所含的上游发行版为基准的台账，使下一次升级能按 replant 实际新增的内容规划。

## 决定

私有增量以分支所含的最新上游发行版为基准度量，既不以更早的发行版为基准，也不以人工挑选的提交对为基准。合并 rc.2 之后，上游基准是 `fb2c4b9e698e30edb738bca4cf0618587db7d203`，故增量为 `fb2c4b9e698e30edb738bca4cf0618587db7d203..42727936501003d214001ef74013a511878c35ae`——以 `--no-renames` 度量 1515 个改动文件、+132011/−2596。在文档提交之前的代码候选 `0888810bd4c41e6b80495df8bbf1eb0c2de50865` 上，同一度量是 1508 个文件、+129876/−2596。

以 rc.1 为基准会把 rc.2 自身的发版算作私有工作。两个基准相差 322 个文件：rc.2 相对 rc.1 改了 334 个文件，其中 272 个是版本行。像 `packages/workflow/workflow/package.json` 这样的路径相对 rc.2 完全没有差异，不能列作私有修改。后续任何升级都以它已合并的上游发行版重新计算基准。

历史台账 52 行保留其记录值。相对 rc.2，31 行仍与历史数字一致，21 行已漂移；同样这 52 个路径的历史切片合计为 +2560/−737，当前增量为 +4957/−718。`packages/session/session-attachment-index` 是行变化最大、也最具误导性的一项：该包在 rc.1 并不存在，故其行覆盖 13 个新文件 +1087/−0，而不是该行记录的 50 行差异。

台账行是包与文件上的 pathspec，因此一行可以覆盖多个文件，而单靠缺口计数无法说明需要保留什么。[rc.2 证据](../../../migrations/0.1.5/evidence/RC2/) 把两类缺口分开记录。其一，228 个在 rc.2 已存在的文件带有私有修改或删除却无台账行，合计 +5978/−1878；其中最大的是 `pnpm-lock.yaml`、`docs/config-catalog*.md`、`apps/desktop/src/main.ts`、`.github/workflows/ci.yml`、`scripts/ci-workflow.spec.ts` 与 `packages/client/ui-conversation`。其二，1041 个文件在 rc.2 不存在，合计 +121331/−0；这一类混合了 replant 自有包与仅因 rc.1 更早而显得新增的文件，因此必须先判定归属，才能用它驱动升级计划。`ledger-rows.json` 与 `ledger-gap.json` 保存完整清单与逐行数字；本 Note 的数字即来自这些文件。

升级冲突数量不能由本阶段外推。rc.2 merge-forward 没有产生生产源码冲突，但它是 334 个文件的发行版，且有 2 个语文配对记录由已配置的驱动解决；更宽的上游区间会触达本次合并从未触碰的文件。

## 已考虑的替代方案

**因为分支最初从 rc.1 分叉而以 rc.1 为基准。** 拒绝。分支已合并 rc.2，因此 rc.1 不再界定私有工作；rc.2 改动的一切都会被报成私有，并被此后每次升级重新推导。

**就地改写历史台账的数字。** 拒绝。历史切片是对一个真实提交对的真实度量，且该 Note 是已实现记录。改写会毁掉那些行如何推导的唯一留存说明。

**用减去历史切片的方式推导增量。** 拒绝。历史切片是私有线上的内部区间，而不是它的前缀：其起点排除了更早的四个提交，其终点排除了 rc.1 合并之后的全部提交。相减会把这些提交的改动归到错误的行上。

**把每个未覆盖路径都当作缺失的台账行。** 按此表述拒绝。228 个被修改的文件才是真正的缺口，因为它们是上游路径上的私有补丁。1041 个新增文件大多是历史台账范围声明已豁免的自有 Science 与 PaperMachine 包；其余需要的是归属判定，而不是各占一行。

**只为 rc.2 这次合并记录一个宽度为 1 的增量。** 拒绝。以合并为范围的计数回答的是另一个问题，并会在下次合并时失效。

## 后果

rc.2 merge-forward 很小；持续增量很大且属于 replant。下一次上游升级应预期语文配对驱动仍是唯一的冲突机制，并应基于 52 行表加两类缺口来安排评审，而不是基于合并大小。

版本行在任何后续合并后都需要独立一步。上游 manifest 会前进到新的 rc 版本，而 replant 自有 manifest 会落在后面，从而破坏 dsh 家族的共享版本不变量（`scripts/release/families.ts` 拒绝混合成员）。rc.2 时有九个自有包需要对齐；`pnpm run release:dsh <version> --dry-run` 会指出它们，而 `scripts/release/bump.ts` 的 `writeVersion` 规则就是要执行的确切改写。npm 家族版本不是产品版本：`apps/desktop/src/product-version.json` 仍为 `0.1.3`，本阶段不改动它。

## 测试

`ledger-rows.json` 与 `ledger-gap.json` 由 `git diff --numstat` 与 `git diff --name-only` 在记录的区间上产出，因此本 Note 的每个数字都能仅凭仓库重算。合并改写的配对记录由 `pnpm run verify-translation-pairing` 覆盖。
