# PaperMachine rc.2 整合记录

日期：2026-09-11。状态：rc.2 基线整合完成；产品发布验收仍未完成。

范围：把官方 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）merge-forward 到审计基线 `7545be293debb9623e439e2257383bf4b39cf3da`。基线已包含 rc.1（合并提交 `d2409f7235` 的第二父），因此本次是 rc.1→rc.2 的增量合并，不是快进。

## 合并结果

- 分支：`codex/replant-0.1.5-rc2`，从 `7545be293d` 建立。
- 命令：`git merge --no-ff --no-edit dsh-v0.1.5-rc.2`，合并提交 `80a3e788bf`。
- 来源改动：334 个文件（272 个 `package.json` 版本行、30 个 `.ts/.tsx/.css`、20 个 Markdown、10 个 `.i18n.yaml`、2 个其他 JSON）。
- 版本对齐提交：`0888810bd4`（代码候选，SHA 由验收方固定）。
- 文档与证据提交：`6b25641ff7`。
- 本阶段新增（`7545be293d..6b25641ff7`）：350 个文件，+3449/−1059。

### 冲突与环境条件

| 条件 | 结果 |
| --- | --- |
| 已配置 `merge.dsh-translation-pairing.driver`（本仓库实际状态） | 退出码 0，**无冲突** |
| 禁用该驱动 | 退出码 1，`packages/client/ui-chat/README.i18n.yaml`、`packages/client/ui-primitives/README.i18n.yaml` |

两种条件都**没有生产源码冲突**：没有 `.ts`/`.tsx`/`.css` 同时落在分叉两侧。上述两个文件是双语文档配对记录，由仓库配对驱动解析；解析后 `pnpm run verify-translation-pairing` 报告 885 对全部一致。无源码冲突这一事实不能外推到未来升级：本次是 334 个文件的窄发行版，更宽的上游区间会触达本次从未触碰的文件。

### 版本对齐

rc.2 只改上游 manifest；9 个 replant 自有包仍停在 `0.1.5-rc.1`，破坏 dsh 家族的共享版本不变量（`scripts/release/families.ts` 的 `verifyVersions` 抛 `dsh release members must share one version`）。按 `scripts/release/bump.ts` 的 `writeVersion` 精确行替换规则把这九个成员更新为 `0.1.5-rc.2`：`bundle/science-app`、`client/ui-brand-papermachine`、`client/ui-science`、`science/science-artifact-store`、`science/science-runtime`、`science/science-session`、`science/tool-science`、`session/session-attachment-index`、`util/byte-size`。`release:dsh --dry-run` 随后报告家族一致。

两个版本维度必须分开陈述：

- **npm 家族版本**：九个自有包内部版本与整个 dsh 家族统一为 `0.1.5-rc.2`；根 manifest 跟随上游 rc 标签是 rc.1 已确立的约定。
- **产品版本**：`apps/desktop/src/product-version.json` 仍为 `0.1.3`，本阶段未改动，也不应擅自改动。

刻意保留未改：`apps/telemetry-receivers`（private，不在 dsh 发布家族）与 4 个 `science-runtime/tests/fixtures/kernel-set-assets*` fixture（不属工作区成员 `packages/*/*`）仍是 `0.1.5-rc.1`；官方 `release:dsh --dry-run` 对二者均无报错。

## 验证结果

除注明外，均在代码候选 `0888810bd4` 或最终提交 `6b25641ff7` 上由本阶段实际执行。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出码 0；合并与版本对齐都未改 `pnpm-lock.yaml` |
| `pnpm run verify-translation-pairing` | 退出码 0；885 对全部一致 |
| `pnpm run typecheck` | 退出码 0 |
| `pnpm run build`（`SDKROOT=MacOSX15.2.sdk`） | 退出码 0；238 个 client artifact |
| `pnpm run lint` | 退出码 0；0 warnings / 0 errors |
| `pnpm run doc-sync` | **退出码 0；34 项通过 / 0 失败**（含 markdown links 与 translation pairing；文档提交后复跑） |
| 包级回归 19 个 spec | 退出码 0；**431 用例通过** |
| Web 普通交付回放（present、produced-files、feedback-release、message-feedback） | 退出码 0；**4 文件 / 17 用例通过** |
| Web Science 回放 | 退出码 1；见下 |

Science 回放的结果按用例归属拆分，不合并计算：

- `apps/web/tests/science-artifact-types.e2e.ts`：**3 项全部通过**（三种媒体类型的成果组、按会话分组并恢复折叠、经 Guide 打开共享成果库）。
- `apps/web/tests/science-preset.snapshot.ts`：**inventory 1 项通过、3 项失败**。通过项是 `keeps the selected generation and sidecar ownership closed`（fixture 文件清单断言）；失败项是 `binds Science before the request...`、`reuses one immutable artifact version...`、`renders the recorded tool turn...`。

`science-preset` 的 3 例失败在 P0 基线（rc.2 合并之前）已存在且形态完全相同，本次合并没有改变它：实时会话未产出 `science/environment-bound` 与 `science/artifact-saved`，UI 因此找不到种子会话。同批无 Science 的 `minimal-preset.snapshot.ts` 通过，说明回放通道本身完好。首因尚未断定，按既有基线问题独立跟踪，不计入本次升级的通过项，最终发布前必须解决并复验。

## 私有补丁台账

当前增量以 rc.2 为基准度量：`fb2c4b9e69..6b25641ff7` 为 1515 个文件、+132011/−2596（`--no-renames`）；代码候选 `0888810bd4` 上为 1508 个文件、+129876/−2596。以 rc.1 为基准会把 rc.2 自身的发版算作私有工作，两者相差 322 个文件。

历史 rc.1 台账保持其历史含义不改写。相对 rc.2，52 行中 31 行与历史数字一致、21 行漂移；历史切片合计 +2560/−737，当前增量合计 +4957/−718。缺口分两类记录在 `evidence/RC2/`：228 个 rc.2 已存在文件带私有修改但无台账行（+5978/−1878），1041 个文件在 rc.2 不存在（+121331/−0，混合自有包与上游新增，需先判归属）。详见 [rc.2 私有补丁台账](../../notes/implemented/process/2026-09-11-replant-rc2-patch-ledger.md)。

## 未做

未刷新任何 expected 或 snapshot；未合并主分支、未发布安装包、未执行公开部署；未改动审计副本既有的 Windows 修复（8 个未提交文件）。未运行 coverage、hygiene、`test:snapshot` 的 acp/sdk/session 通道与 Windows 矩阵，未做安装包实机验收。
