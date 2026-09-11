# Agent Note：replant rc.2 私有补丁台账

Status: implemented

[English](2026-09-11-replant-rc2-patch-ledger.md) | 中文

## 问题

[rc.1 补丁台账](2026-09-09-replant-upstream-patch-ledger.zh.md) 度量的是一个已冻结的历史切片 `ce76a86204..6528088e9f8c579024124add2642cde5a062ff16`。那些数字对该切片成立，但它们不是分支相对上游的当前增量；而且那份台账是已实现记录，其数字不能就地改写。rc.2 merge-forward 之后，分支需要一份区间由 merge base 推导、而不是由人工挑选的提交对推导的台账，使下一次升级能按真实数字规划。

## 决定

当前私有增量是「上游 merge base 到候选提交」的区间，不是历史提交对。对 rc.2 候选它是 `183f08e9c6dde7e36cd2318eaee70b0da08fb35e..0888810bd4c41e6b80495df8bbf1eb0c2de50865`——55 个提交、1830 个改动文件、以 `--no-renames` 度量 +130922/−3642。区间起点是 `git merge-base HEAD dsh-v0.1.5-rc.1`，因分支已在 `d2409f7235` 合并 rc.1 而等于 rc.1。后续升级重新计算该起点，不复抄字面值。

历史台账 52 行保留其记录值。在当前区间上，3 行仍精确一致，49 行已漂移；同样这 52 个路径的当前合计为 +5003/−764，历史为 +2560/−737。三行一致的是 `packages/api/remotes`（+6/−3）与两个 `scripts/verify-application-entrypoints*` 文件（+4/−0、+10/−0）；它们是唯一没有被历史切片之外的提交触碰过的行。

台账行是包与文件上的 pathspec，因此一行可以覆盖多个文件。有两个后果规模很大且容易被忽略，故记录在此，供下一次升级规划。其一，`packages/session/session-attachment-index` 不是 50 行的差异：该包在 rc.1 并不存在，该行实际覆盖 13 个新文件 +1087/−0。其二，有 500 个在 rc.1 已存在的文件带有私有修改或删除却完全没有台账行，另有 1041 个新增文件。未覆盖路径与逐行重算在 [rc.2 证据](../../../migrations/0.1.5/evidence/RC2/) 中以机器可读形式保存（`ledger-rows.json`、`ledger-gap.json`）；本 Note 的数字即来自这些文件。

## 已考虑的替代方案

**就地改写历史台账的数字。** 拒绝。历史切片是对一个真实提交对的真实度量，且该 Note 是已实现记录。改写会毁掉那些行如何推导的唯一留存说明，也不会让当前增量更准确。

**用 `rc.1..candidate` 减去历史切片来推导当前增量。** 拒绝。历史切片是私有线上的内部区间，而不是它的前缀：其起点排除了更早的四个提交，其终点排除了 rc.1 合并之后的全部提交。相减会把这些提交的改动悄悄归到错误的行上。

**把每个未覆盖路径都当作缺失的台账行。** 对 1041 个新增文件拒绝，它们是历史台账自身范围声明已豁免的自有 Science 与 PaperMachine 包。500 个被修改的上游路径才是真正的缺口，因为那正是台账存在的意义所追踪的私有补丁，且至少有 `pnpm-lock.yaml`、`apps/desktop`、`.github/workflows`、`scripts/ci-workflow.spec.ts` 与 `packages/client/ui-conversation` 大到足以改变升级计划。

**只为 rc.2 这次合并记录一个宽度为 1 的增量。** 拒绝。rc.2 合并带来 334 个文件与 2 个文本冲突，但台账的职责是分支相对上游的持续增量，下一次升级必须在其上变基。以合并为范围的计数回答的是另一个问题，并会在下次合并时失效。

## 后果

rc.2 merge-forward 本身很小：334 个源文件、无生产源码冲突、两个由已配置的 `merge.dsh-translation-pairing.driver` 解决的语文配对记录。持续增量很大且属于 replant，因此下一次上游升级应预期配对驱动是唯一的冲突机制，并应基于 52 行表加缺口清单来安排评审，而不是基于合并大小。

版本行在任何后续合并后都需要独立一步。上游 manifest 会前进到新的 rc 版本，而 replant 自有 manifest 会落在后面，从而破坏 dsh 家族的共享版本不变量（`scripts/release/families.ts` 拒绝混合成员）。rc.2 时有九个自有包需要对齐；`pnpm run release:dsh <version> --dry-run` 会指出它们，而 `scripts/release/bump.ts` 的 `writeVersion` 规则就是要执行的确切改写。

## 测试

`ledger-rows.json` 与 `ledger-gap.json` 由 `git diff --numstat` 与 `git diff --name-only` 在记录的区间上产出，因此本 Note 的每个数字都能仅凭仓库重算。合并改写的配对记录由 `pnpm run verify-translation-pairing` 覆盖。
