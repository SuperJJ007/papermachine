# P6 — Science snapshot / expected migration

## 完整 built headless 验收

2026-09-10：使用现有构建产物，实际执行 `PATH=/private/tmp/dsh-rc1-node/bin:/opt/miniconda3/bin:$PATH DSH_EXAMPLE_MODE=lib DSH_SNAPSHOT=replay node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts`。完整文件结果 **95 passed、2 skipped（本机无 pwsh）**，不是 source-only 结果。日志 `/private/tmp/pm-p6-headless-built-full.log`。

headless 的显式 composition 来源登记覆盖 LSP 三包、Codex/Claude Code 产品子代理、ACP 子代理和 Python code runtime，以及已有 replay/PTY 来源。所有链接都指向真实 package 目录并位于测试隔离 home，沿用缺失 manifest 必须拒绝的 loader-smoke 支持；没有关闭 inventory、放宽比较或更新 expected。没有新增 manifest 依赖，没有运行 build/install。

owning README 双语均使用显式 `overlay-package-provenance` anchor，Agent Note 链接统一到该 fragment。更新双语内容、record 后执行完整 `verify-translation-pairing`：878 对全部一致。定向 headless lint 与 git diff --check 通过。ACP/SDK 其他失败由 CI agent 负责，不以本记录宣称通过。

日期：2026-09-10。工作树：`/Users/superjj/ccproj/pm-replant`。本记录覆盖受委派的 P6 快照迁移，不代表全仓 P5/P6 或平台验收完成；主 agent 统一执行最终 build/check。未提交、未 push，未执行 install 或修改 node_modules。

## 后续修复完成：保留 inventory 的真实来源装配

本节更新审计阶段结论；下文保留当时诊断及原始错误作证据。三个 composition 保持恢复后的原始字节，没有 inventory 禁用，没有 expected 重录。

修复位于 `packages/test-support/loader-smoke/src/index.ts`：新增 `profilePackages` 显式映射，将测试 overlay 的 npm 名称与真实 package 目录关联。harness 在临时 cwd 拥有的 DSH_HOME 中建立 profile module fallback 链接；启动前读取真实 manifest，验证匹配的 name 与非空 version。缺失目录、缺失/不匹配的 manifest 或已有链接冲突均失败；没有合成 manifest、忽略 referent 或改变 inventory。`snapshots/session/headless.snapshot.ts` 在 replay 时声明 llm-replay，PTY composition 另外声明 tool-terminal。CLI/product manifest、app-boot runtime、inventory runtime 与安装 node_modules 均未改；仅测试临时 home 中建立 fixture 链接，随 cwd 清理。

验证：

- 五个原失败用例：inventory 保持启用，5/5 passed。日志 `/private/tmp/pm-p6-inventory-fixed-replay.log`。
- 最终相邻复验：同五例 + Science，6/6 passed、91 按名称筛选 skipped。日志 `/private/tmp/pm-p6-inventory-final-replay.log`。
- loader-smoke：3 文件 36/36 passed，src/index.ts statements/branches/functions/lines 均 100%。日志 `/private/tmp/pm-p6-loader-overlay-coverage.log`，独立覆盖率目录 `/private/tmp/pm-p6-loader-overlay-coverage`，未干扰主 agent fullcoverage。
- 新负例验证缺失包、错误 name/version、非自有 home 均拒绝，正例验证 profile 的 Node manifest resolution 指向真实包，并验证所有临时链接清理；inventory owning suite 11/11 包含 missing-manifest 仍拒绝的原用例。
- 定向 lint、owning README/Agent Note 中英文配对、四个 Markdown 的链接/锚点检查及 git diff --check 通过。

README：`packages/test-support/loader-smoke/README.md`；Agent Note：`.agents/notes/implemented/testing/2026-09-10-smoke-overlay-package-provenance.md`，两者均已同步中文及 pairing。无需新增依赖或统一 install；没有执行 build/install，没有提交/push。主 agent 的全仓 build/check 仍独立验收。

## 交付

- `snapshots/session/science-tools/`：真实 API V3、manifest、独立 Science prompt/schema sidecar，通过 shipped `science-headless` profile 正式重放。
- `snapshots/web/science-preset/`：真实 API V3、manifest、prompt/schema/UI expected；标准 Science Web scaffold 执行完整模型回合、持久化比较、浏览器显示及刷新恢复。
- 纯 UI 的六组 Science expected 迁至 `apps/web/tests/expected/`，对应测试引用同步；原先 Web 私有 kernel fixture 移至 science-runtime 包测试 fixture，Web 保留导出入口。
- 旧 model-view 由正式 Session 与 header sidecar 覆盖；chart-preview 归属 runtime 包测试；cold-history/source-agreement 归属 Web projection expected。冷恢复明确断言 live kernel 的 started 变为 interrupted，没有归一化掉状态差异。
- `session-snapshot/src/science.ts` 只处理已知 Science 事件、结构化状态和指定 system-prompt section 的波动字段。指纹/路径 token 保留相等关系与不一致关系；普通用户文本、未知事件、源码、hash、版本、stdout 字节数仍参与比较。未知 JSON 对象先校验再访问，两个编译报错均通过局部变量收窄修复。
- `science-headless` manifest/profile、headless adapter 与 Web corpus adapter 已接通，无新增 package manifest 依赖；README 与 Agent Note 中英文及配对记录已同步。

Inventory 三个非Science composition 保持原配置；loader-smoke 在隔离 home 装配真实 overlay 包，保留 inventory 的五例重放已通过。

## 录制真实性与范围

两个正式场景使用真实模型 API 录制。便携 replay 的 package-owned interpreter fixture 只接受被录制的确切 Python 源码，使用已独立验证的 PNG；模型以外的工具、runtime、约束检查及 artifact store 正常执行。不同源码的独立协议验证返回 UnexpectedSnapshotSource，且不创建输出或 artifact。该 fixture 不证明任意 Python 程序或跨平台解释器行为。

另保留 shipped CLI + 生产 Python/Conda 的真实运行证据：51 个 V3 events，get_science_state → run_python → annotate_artifact 两次 → get_science_state，1 次成功运行、0 个工具错误、3 次发布均指向版本 1、完成回合，PNG 6,876 字节且 SHA-256 为 `f1b73f3b47f69bd28251db4cf4b99d89277b680edf4e96b6d75311768b8eb465`。原始证据位于 `/private/tmp/p6-migration-evidence/success/`，仓库保留摘要与校验值。录制使用隔离 PAPERMACHINE_HOME，没有输出或写入密钥。

初次正式录制已完成模型回合，但暴露独立 workspace oracle 缺少项目标记，以及 cold projection 的既有 interruption 语义。修正 seed 与断言后，使用 keyless refresh 生成当前 expected，再以只读 replay 验证；不把初次 record 命令记为全绿。旧 lifecycle 两份 UI expected 仅增加 P4 原生右栏按钮，review 后 refresh，9/9 只读复验通过。

## 验证

所有命令直接调用 `node node_modules/vitest/vitest.mjs` 或 `node --import tsx/esm`，Node PATH 为 `/private/tmp/dsh-rc1-node/bin:/opt/miniconda3/bin` 加原 PATH。所有 replay 明确使用 `DSH_SNAPSHOT=replay`。

| 命令参数或检查 | 结果 |
| --- | --- |
| `run packages/test-support/session-snapshot/tests` | 8 文件，351 passed、1 skipped |
| `run packages/test-support/session-snapshot/tests/science.spec.ts --coverage --coverage.include=packages/test-support/session-snapshot/src/science.ts --coverage.reportsDirectory=/private/tmp/p6-support-coverage` | 7 passed；Science statements/branches/functions/lines 全部 100% |
| `run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t 'science-tools\|advanced-toolchain$\|compaction-recovery\|pty-tools-sandbox-backend'` | 历史禁用 inventory 状态，已由上方最终 6/6 启用状态复验替代 |
| `run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts -t advanced-toolchain` | 历史禁用状态；启用状态证据见上方最终复验 |
| `run --config vitest.web.config.ts apps/web/tests/science-preset.snapshot.ts` | 4 passed |
| `run --config vitest.snapshot.config.ts scripts/session-snapshot-corpus.corpus.ts` | 3 passed |
| `run packages/test-support/llm-replay/tests/session-format-corpus.spec.ts` | 358 passed |
| `run packages/science/science-runtime/tests/chart-edit.spec.ts -t 'renders through a warm kernel'` | 1 passed，expected 只读 |
| `run scripts/translation-prompt.expected.spec.ts` | 1 passed；未改脚本 owner 文件 |
| 六组迁移后的 Science UI | 6 文件，21 passed |
| 旧 fork Web expected 所属八组与 lifecycle | 八组原运行通过；lifecycle 修正两份 expected 后单独 9/9 通过 |
| 本次拥有的 TS 文件定向 lint | 通过；完整编译结果由主 agent 记录 |
| README、Agent Note 定向 translation-pairing | 2 对通过 |
| `git diff --check` | 通过 |

[37 项逐路径对账](evidence/P6-snapshots/expected-ledger.json)：35 项当前 replay/所属测试已验证（inventory 相关项已在启用状态复验）；2 项 Pwsh fixture 已迁移但本机无 pwsh，保留 P3 证据与 P6 跳过，不宣称本次执行。没有缺失项。不要将按名称筛选导致的其他 skipped 计作平台失败。

[检查摘要、日志与 fixture SHA-256](evidence/P6-snapshots/checks.json)；[验证日志](evidence/P6-snapshots/validation-logs.tar.gz)。全仓 build/check、desktop、平台适配由主 agent/对应 owner 验收，本次未运行。
