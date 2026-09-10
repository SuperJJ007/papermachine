# 补验收记录

Commit status: the repairs are committed locally; see [step 1 closeout](step-1-closeout.md). Statements about uncommitted work below describe the original acceptance date.

日期：2026-09-11。工作目录 /Users/superjj/ccproj/pm-replant，分支 replant/0.1.5。接续 manual-acceptance-handoff.md 与 manual-fixes-closeout.md；本轮修改尚未提交或推送。

## 实机结果

- 中文文件名附件：原生文件选择器上传 /private/tmp/pm-followup-acceptance-20260911/中文数据.csv，在 CREDENTIAL RESTART OK reply 会话用真实 Python 只读统计，4 行、3 列、1 个缺失值，编号合计 10、数值合计 14。原件 SHA-256 前后均为 e478cb8ff2fb47a584bc376a28ad12960314c53b5c77672a740d045f5386c874。
- 双轴修改：Python 和 R 变量操作对比会话的 xy_line_chart.png 从 v3 保存为 v4，轴标题为 Supplement X / Supplement Y；返回 v3 仍显示原轴标题。
- 图例与文本：真实 Python 新建 series_ab_chart.png 和 supplement_note.txt，文本成果 GUI 显示 SUPPLEMENT TEXT OK；图例从原位置改为右下并保存为 v2。
- 双工作区：gui-workspace 的 GUI WORKSPACE DRAFT 与 DSHscience 的两行 MULTILINE 草稿分别保留；切回恢复对应草稿。DSHscience 成果库为 0 个成果，没有显示 gui-workspace 的成果。
- 主题及重开：深色设置可读，已恢复跟随系统。多次 Finder 重开保留草稿、右栏标签和图例 v2；内核最近记录显示已中断。
- 环境覆盖：发现已配置路径替换后误报已生效。修复为 Host 在脱敏前比较存储值与生效值，Remote 和客户端传递 pendingRestart。实机替换为指向原环境的隔离符号链接后正确显示待重启，Finder 重开后显示已生效；移除覆盖再次显示待重启，已正常退出重开并恢复原始配置层。

## 原生粘贴故障及修复

用户确认普通中文输入可用，但粘贴失败。此前自动化 paste 的剪贴板超时只能作为未完成证据；用户复现后追查桌面菜单，确认适配版 main.ts 只注册应用菜单，遗漏旧版 application-menu.ts 已有的 Electron editMenu。此遗漏使 macOS 标准编辑快捷键失效，属于 PaperMachine 桌面迁移回归。

恢复 editMenu 后重建桌面，Finder 重开，同一个原生 paste 调用成功，输入框精确显示“中文粘贴验收第一行”及第二行“第二行保留换行”；没有发送。Cmd+A、删除、Cmd+Z 也恢复原草稿。10 项桌面启动测试通过，其中启动路径检查编辑菜单注册。原生快捷键结果来自实际 Electron，不用浏览器模拟粘贴充当证明。

## 自动化与既有证据

- 6 个真实 Web 文件共 35 项通过：stats-paged-history、workspace-management、file-upload-round、science-artifact-types、science-settings、steering。日志 /private/tmp/pm-followup-acceptance-20260911/web-gaps.log。长历史和引导的本轮证据为真实 Web 组合，不扩大为原生手工操作结论。
- 旧格式存储、环境设置与原生目录流程定向测试共 58 项通过，日志 focused.log（同目录）。旧 Science 三份真实 V0 副本的读写拒绝、原件摘要/mtime/inode 不变及无后继文件，既有证据在 evidence/P3/real-v0.json，主交接之前遗漏引用。
- 恢复页诊断复制与正常退出的既有实机证据在 P5-P6-plan.md，日志 /private/tmp/pm-p5-recovery-gui.log。本轮未破坏验收 home 来重复触发恢复页。
- 环境修复及受影响设置夹具 14 文件 457 项通过，日志 settings-final.log。新增 science-settings 实际 Web 场景覆盖已配置秘密值替换、页面刷新和 Host 重启；refresh 6/6、replay 6/6，新增 replacement.expected.md。
- PaperMachine 全构建通过，238 个客户端产物，日志 build.log。粘贴修复后单独重编桌面 TypeScript 与 tsdown；已确认 apps/desktop/lib/main.js 包含 editMenu。

## 范围

本记录将完成的补验收与证据补齐；尚未把完整 23 项清单全部逐项复跑，尤其 XLSX/RDS 的原生上传组合和独立真实输入法候选态的自动化不能由 CSV 或普通输入代替。添加工作区原生目录选择器本轮未完成，工作区隔离使用两个已有工作区验证。远程 CI、跨版本 seed 升级、签名与平台矩阵仍不在本轮完成范围。
