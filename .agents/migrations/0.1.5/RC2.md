# PaperMachine rc.2 整合记录

日期：2026-09-11。状态：rc.2 基线整合完成并通过本轮自检；产品发布验收仍未完成。

范围：把官方 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）merge-forward 到审计基线 `7545be293debb9623e439e2257383bf4b39cf3da`。基线已包含 rc.1（合并提交 `d2409f7235` 的第二父），因此本次是 rc.1→rc.2 的增量合并，不是快进。

## 合并结果

- 分支：`codex/replant-0.1.5-rc2`，从 `7545be293d` 建立。
- 命令：`git merge --no-ff --no-edit dsh-v0.1.5-rc.2`，合并提交 `80a3e788bf`。
- 来源改动：334 个文件（272 个 `package.json` 版本行、30 个 `.ts/.tsx/.css`、20 个 Markdown、10 个 `.i18n.yaml`、2 个其他 JSON）。
- 版本对齐提交：`0888810bd4`。
- 本阶段合计改动（`7545be293d..HEAD`）：343 个文件，+1059/−1059。

### 冲突与环境条件

| 条件 | 结果 |
| --- | --- |
| 已配置 `merge.dsh-translation-pairing.driver`（本仓库实际状态） | 退出码 0，**无冲突** |
| 禁用该驱动 | 退出码 1，`packages/client/ui-chat/README.i18n.yaml`、`packages/client/ui-primitives/README.i18n.yaml` |

两种条件都**没有生产源码冲突**：没有 `.ts`/`.tsx`/`.css` 同时落在分叉两侧。上述两个文件是双语文档配对记录，由仓库配对驱动解析；解析后 `pnpm run verify-translation-pairing` 报告 884 对全部一致。

### 版本对齐

rc.2 只改上游 manifest；9 个 replant 自有包仍停在 `0.1.5-rc.1`，破坏 dsh 家族的共享版本不变量（`scripts/release/families.ts` 的 `verifyVersions` 抛 `dsh release members must share one version`）。按 `scripts/release/bump.ts` 的 `writeVersion` 精确行替换规则把这九个成员更新为 `0.1.5-rc.2`：`bundle/science-app`、`client/ui-brand-papermachine`、`client/ui-science`、`science/science-artifact-store`、`science/science-runtime`、`science/science-session`、`science/tool-science`、`session/session-attachment-index`、`util/byte-size`。`release:dsh --dry-run` 随后报告家族一致。

品牌与产品身份未改：`ui-brand-papermachine` 只有版本行变化；产品版本跟随上游 rc 标签是 rc.1 已确立的约定（`RC1.md`：「自有包内部版本更新为 `0.1.5-rc.1`」，且基线根 manifest 一直等于上游 rc 版本）。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出码 0；合并未改 `pnpm-lock.yaml` |
| `pnpm run verify-translation-pairing` | 退出码 0；884 对一致 |
| `pnpm run typecheck` | 退出码 0 |
| `pnpm run build`（`SDKROOT=MacOSX15.2.sdk`） | 退出码 0；238 个 client artifact |
| `pnpm run lint` | 退出码 0；0 warnings / 0 errors |
| 包级回归 19 个 spec | 退出码 0；**431 用例通过** |
| Web 普通交付回放（present、produced-files、feedback-release、message-feedback） | 退出码 0；**4 文件 / 17 用例通过** |
| Web Science 回放（science-preset、science-artifact-types） | 退出码 1；`science-artifact-types` 4 例通过，`science-preset` 3 例失败 |

`science-preset.snapshot.ts` 的 3 例失败在 P0 基线（rc.2 合并之前）已存在且形态完全相同，本次合并没有改变它：实时会话未产出 `science/environment-bound` 与 `science/artifact-saved`，UI 因此找不到种子会话。同批 `science-artifact-types.e2e.ts` 与无 Science 的 `minimal-preset.snapshot.ts` 均通过，说明回放通道本身完好。该失败按 P0 报告 §4.4 作为既有基线失败独立跟踪，不计入本次升级的通过项。

## 未做

未刷新任何 expected 或 snapshot；未合并主分支、未发布安装包、未执行公开部署；未改动审计副本既有的 Windows 修复（8 个未提交文件）。未运行 coverage、hygiene、doc-sync、`test:snapshot` 的 acp/sdk/session 通道与 Windows 矩阵。
