# 实机验收交接：2026-09-11

第 1、2 步当前收尾：[已验收成果与提交](step-1-closeout.md)、[工作目录选择修复及剩余平台验收](step-2-closeout.md)。

Current checkpoint: [step 1 closeout](step-1-closeout.md) records the four local repair commits and the accepted evidence. The observations below retain the original acceptance context; superseded gaps are resolved by the two linked closeout records. Windows/WSL acceptance remains separate.

本记录接续[实机验收清单](manual-acceptance.md)。验收对象为提交 ddccc29695，分支 replant/0.1.5，工作目录 /Users/superjj/ccproj/pm-replant。该提交包含此前迁移代码；本记录不包含产品修复，整体验收尚未完成。

## 两项问题收尾：2026-09-11

标题取消问题已修复并复验；桌面凭据提示已定位为验收密钥未持久保存，按用户明确授权保存后通过 Finder 重启与真实模型请求。详见[两项问题收尾记录](manual-fixes-closeout.md)。下文保留原始复现及当时观察，不再作为这两项的当前待办。整体迁移验收范围不变。

## 原始标题取消问题

图表点击“放弃修改”后，标题输入框仍保留临时预览文字。用户已明确确认这是问题；修复结果见上方收尾记录。

复现会话为“Python 和 R 变量操作对比”，成果为 xy_line_chart.png。保存标题 Manual acceptance sum ten 为 v2；临时改为 Discard this preview；点击“放弃修改”。实际没有新增版本，但输入框仍显示 Discard this preview，切换版本后才恢复 Manual acceptance sum ten。预期点击放弃即恢复已保存标题，预览及待修改状态同步恢复，旧版本不被覆盖。已有保存内容未丢失。

## 更正和启动观察

用户确认工作区功能正常。自动化点击后未观察到文件夹选择窗口，不构成产品故障；不得继续把“添加工作区失效”当作已确认缺陷。自动化未完成的双工作区验收仍不计通过。

应用关闭后可以重开。Finder桌面入口连续三次启动成功，会话和两栏成果库均恢复；但这三次都出现API Key配置提示。此前设置页显示密钥由启动环境提供且只读，因此不能断言凭据被删除。待检查桌面启动时的凭据来源，未保存、更换或输出密钥。

当前 /Applications/PaperMachine.app 是本地开发启动器，桌面同名入口是其符号链接。它依赖 /Users/superjj/ccproj/pm-replant 源码和 /private/tmp/dsh-rc1-node/bin/node，并非独立签名安装包。不要删除这些依赖后仍声称可以启动。启动日志为 /private/tmp/pm-local-launcher.log。

## 已执行验收

- About：PaperMachine 0.1.3，内部 dsh 0.1.5-rc.1；Python/R真实执行合成数据，x求和10、均值2.5，图表四点和CSV四行实际预览正确。
- 同会话Python x=1234跨轮保持；新会话“Check if x exists in Python and R kernels”中Python与R均确认x不存在。重启后界面明确标记内核已中断；重启后的模型执行尚未复核。
- 中文列名CSV缺失值与统计正确，源文件哈希不变。GUI上传、中文文件名未完整覆盖。
- Chat、Process、Trajectory可切换，执行代码与stdout/stderr可见；历史“Python 和 R 合成数据验收”第2轮显示正确请求，Chat保留首轮启动失败。
- 图表和CSV预览、PNG灯箱、图表标题预览、保存v2、旧v1内容、v1代码溯源及v2人工修改标记已核对。取消编辑缺陷见上文；坐标轴和图例编辑未全覆盖。
- 测试备注保存后重启仍在，删除后三次重启未重新出现。
- 停止Python运行后显示已中止，随后新请求返回RECOVERY OK。运行中排队消息在WAIT DONE完成后作为独立轮返回QUEUE CHECK；引导快捷键未覆盖。
- 多成果标签、两栏、宽度拖动和版本切换可用。有内容会话正常退出重开后，图表v2、CSV标签、成果库和备注恢复。空会话两栏成果库连续三次正常退出重开均恢复；本轮未复现历史布局丢失，但未解释其原因。
- 浅色主题切换并恢复系统主题；模型安全只读字段及取消入口可用；Science两项前缀显示已配置并生效，空输入保存禁用。

## 未完成与后续范围

中文IME及多行粘贴受自动化字符注入失真、粘贴超时影响，不能判为产品吞字或验收通过。长历史分页、双工作区操作、旧格式副本、文本成果、环境覆盖后待重启状态、恢复页诊断复制等未完成分支仍需补验。远程CI、完整跨版本seed升级和未应用的遥测/workflow事项保留；签名安装包与平台矩阵不属于本次本地GUI验收。

验收home为 /Users/superjj/ccproj/pm-replant/apps/desktop/.desktop-build/acceptance-20260910/home，合成数据工作区为 /private/tmp/pm-p5-acceptance-20260910/gui-workspace。保留这些会话和成果用于复现；不要重新清空home或安装Python/R环境。原始自动化流水记录位于 /private/tmp/pm-manual-acceptance-20260910/results.md，其中工作区故障判断已由本记录更正。

补验收最新结果及粘贴/环境状态修复见 [manual-supplement-closeout.md](manual-supplement-closeout.md)。原生粘贴故障已确认为桌面迁移遗漏编辑菜单，并已实机修复验证。
