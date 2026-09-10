# 实机验收两项问题收尾

Commit status: the repairs are committed locally; see [step 1 closeout](step-1-closeout.md). Statements about uncommitted work below describe the original acceptance date.

日期：2026-09-11。工作目录 /Users/superjj/ccproj/pm-replant，分支 replant/0.1.5，基于 fe91de4527。本记录覆盖用户要求优先完成的标题取消与桌面凭据两项，代码及记录尚未提交或推送，不表示整个 P5/P6 或发布验收完成。

## 图表放弃修改

原因：待提交操作和预览已清空，但文本、字体、图例和复选框各自保留控件草稿。放弃操作重建直接编辑控件组，从当前已保存图表恢复全部输入；在途预览继续由原有效期检查拒绝。

新增回归在修复前确实失败，四个文本输入仍为 Unsaved preview。修复后同时检查标题、副标题、双轴标题、图例、网格、字体族和字号恢复；后续仅改字号不会带回已放弃的字体族。另验证取消时已开始的预览完成后不重新显示。

真实 Web 组合比较原图像 URL、恢复标题、禁用保存按钮以及逐事件相等的会话日志，新增 title-discard.expected.md；既有 expected 未改变。桌面复验沿用“Python 和 R 变量操作对比”的 xy_line_chart.png：v2 的非当前版本预览被 Runtime 拒绝后仍能取消并恢复标题；切到本轮已存在的最新 v3，改为 Discard regression check，真实内核预览完成后取消，标题立即恢复 Manual acceptance sum ten，预览提示消失，框选可用，保存与放弃按钮禁用，仍为 v3。本轮未提交图表新版本。

## 桌面 API Key

检查时验收 home 的 .credentials.yaml 存在，但没有 DEEPSEEK_API_KEY；home 和开发目录也没有提供该 key 的 .env。原桌面模型设置显示未配置输入框。开发命令环境有可用 key，工具直接启动应用会继承它，因此显示只读来源；这不能证明 Finder 独立启动可用。

用户明确同意保存现有验收密钥后，通过 LocalCredentialProvider.set 保存到 apps/desktop/.desktop-build/acceptance-20260910/home/.credentials.yaml。无启动环境的独立 provider 重开确认 configured=true、source=file；文件权限为 0600，路径被 Git 忽略。没有更换密钥、写入源代码或输出密钥值。

随后正常退出应用，通过 Finder 桌面 PaperMachine.app 的“打开”操作启动。没有密钥配置弹窗；模型设置显示“API 密钥已配置”，编辑框不再显示“由启动环境提供（只读）”。在 gui-workspace 新建验证会话，发送不使用工具的简短请求，收到精确答复 CREDENTIAL RESTART OK，发送按钮恢复空闲。会话标题为“CREDENTIAL RESTART OK reply”，保留供复核。

此保存仅作用于现有隔离验收 home。桌面入口仍是依赖源码和临时 Node 的开发启动器；正式安装包及其他 home 的配置不在本次范围。

## 执行检查

- 四个定向文件：ScienceChartEditPanel.client.spec.tsx、ArtifactContent.client.spec.tsx、ScienceDetailsView.chart-edit.client.spec.tsx、onboarding-dialog.client.spec.tsx，共 128 项通过；使用 Node 24.14.0 直接调用 node_modules/vitest/vitest.mjs run。
- PaperMachine 完整构建：scripts/build.ts --profile papermachine，通过并记录 238 个客户端产物。默认 macOS SDK 首次与链接器不匹配；使用 RC1 交接指定的 SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk 后通过。日志 /private/tmp/pm-fix-discard-build.log。
- science-chart-outcome.e2e.ts：vitest.web.config.ts 下 refresh 6/6，随后 DSH_SNAPSHOT=replay 只读 6/6；日志 /private/tmp/pm-fix-discard-web-refresh.log 与 /private/tmp/pm-fix-discard-web-replay.log。
- README 与现有 science-viewer-lifecycle 决策说明的中英文及配对摘要同步；scripts/run-gates.ts doc-sync 全部 34/34，通过日志 /private/tmp/pm-fix-discard-doc-sync.log。
- 三个修改的 TypeScript 文件通过 scripts/run-oxlint.ts 定向检查；首次行长度问题已修正。git diff --check 通过。

完整覆盖率及跨平台检查未在本轮重跑。远程 CI、seed 升级与其他未完成验收仍按主交接保留。
