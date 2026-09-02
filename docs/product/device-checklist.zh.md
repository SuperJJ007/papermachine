# PaperMachine 实机验收清单

[English](device-checklist.md) | 中文

PaperMachine 桌面 DMG 的主实机验收清单。每一项都带一个稳定的 `<area>.<item>` id,方便[发布记录](../releases/README.zh.md)按精确条目引用结果,而不必重复条目本身;id 一旦分配,不会挪给另一项检查复用。新条目追加在所属方向的末尾,而不是插进已有 id 中间,所以同一方向下的 id 顺序不总是和条目自然的先后一致。

一次发布在跑这份清单时有两种选法:**全量**——按顺序跑完所有条目——适用于某个构建的第一次实机验收,或者拿不准的时候;**增量**——跑一个有针对性的子集——适用于复测一批具体修复:上一版发布实机验收里没过或部分通过的条目、这一版新增的条目,以及本次改动涉及方向里对已过项做的一次简短回归抽查。[0.1.1-rc.3.md](../releases/0.1.1-rc.3.zh.md)跑的是全量清单;[0.1.1-rc.4.md](../releases/0.1.1-rc.4.zh.md)跑的是基于 rc.3 自身结果构造的增量。**首次出现**这一列记录条目是从哪个版本开始进入这份清单的,不追踪某条目预期结果最近一次是何时改的——本页始终陈述当前的预期行为,行为的变化说明放在对应发布记录自己的"改了什么"一节。

| id | 方向 | 动作 | 预期 | 首次出现 |
|---|---|---|---|---|
| 0.1 | 换装 | 退出旧版 PaperMachine,把新构建的 `PaperMachine.app` 拖到 `/Applications` 覆盖,再启动。 | Finder 简介里显示新版本号;启动直接进工作台,不出现 "Science Host needs attention"。 | rc.3 |
| 0.2 | 换装 | 可选,通常跳过——用于复现纯首装:退出应用,把 `~/.papermachine` 挪走,再启动;测完把它挪回来。 | 启动进入 onboarding 安装页而不是工作台(跳过这一步会保留现有环境、API key 和会话)。 | rc.3 |
| 1.1 | 启动与环境 | 正常启动。 | 直接进工作台;侧栏显示已有的工作区和历史会话;左上角是鲸鱼标志加 PaperMachine 字标。 | rc.3 |
| 1.2 | 启动与环境 | 可选——纯首装流程(见 0.2)。 | 确认面板注明约 494 MB、磁盘需求,默认选 TUNA、可切换 USTC/官方,安装中显示阶段文字,完成后进入工作台。 | rc.3 |
| 1.3 | 启动与环境 | 退出再启动。 | 侧栏展开/收起状态和详情面板的开合状态与上次一致(端口记忆);会话列表完整。 | rc.3 |
| 1.4 | 启动与环境 | 打开应用菜单的 Change Environment…。 | onboarding 页面顶部显示当前已应用环境的 id、版本号、applied/stale 状态和路径;当已应用版本与标准声明一致时,主按钮是 "Reinstall"(注明约 520 MB 的下载量);"Keep current environment" 能在此期间不停 Host 的前提下直接回到工作台。 | rc.3 |
| 1.5 | 启动与环境 | 启动后查看 `~/.papermachine/logs/` 目录。 | 存在 `host.log` 文件;打开能看到 Host 启动输出,形似 API key 的值已脱敏。 | rc.4 |
| 2.1 | 品牌与外壳 | 看左上角;点击侧栏的收起按钮。 | 展开态:鲸鱼标志加常规体 "Paper" 和加粗 "Machine";收起态只剩鲸鱼标志。 | rc.3 |
| 2.2 | 品牌与外壳 | 看窗口标题栏。 | 显示 "\<会话标题\> — PaperMachine";新会话页显示 "PaperMachine"(首次绘制时闪一下旧名字属已知的外观小问题)。 | rc.3 |
| 2.3 | 品牌与外壳 | 把系统切到深色模式。 | 窗口背景跟随的是应用内的 Appearance 设置,而不只是系统:Appearance 设为 System 时,窗口实时跟随系统主题切换,深色下文字、面板和成果库都可读;Appearance 明确设为 Light 或 Dark 时,窗口保持该背景,系统主题切换不会闪一下不匹配的颜色。 | rc.3 |
| 2.4 | 品牌与外壳 | 详情面板关闭时点侧栏的 Artifacts 入口;打开一张图;再点一次 Artifacts。 | 第一次点击打开成果库;第二次点击关闭详情面板;第三次点击(打开图之后)从图返回成果库列表——这是一个三态开关,不会卡在打开状态。 | rc.3 |
| 2.5 | 品牌与外壳 | 点右上角的面板图标(Science 详情)。 | 详情面板开/关切换;之后点侧栏 Artifacts 入口能重新打开它。 | rc.3 |
| 3.1 | Python 运行与内核 | 新会话:"读一下工作区里的某个 CSV,告诉我有哪些列"(用相对路径命名文件)。 | `run_python` 卡片显示 Success,stdout 可展开,回答准确;模型通过 `SCIENCE_WORKSPACE_DIR` 或绝对路径读到文件,不会报 `FileNotFoundError`。 | rc.3 |
| 3.2 | Python 运行与内核 | 接着问:"用刚才的 df 算一下每列缺失率。" | 模型直接复用上一轮的变量,不重新读文件;卡片的 Kernel # 不变。 | rc.3 |
| 3.3 | Python 运行与内核 | 问:"现在内核里有哪些变量?" | 模型走 `get_science_state`,列出变量名、类型和形状。 | rc.3 |
| 3.4 | Python 运行与内核 | 让它执行一段必定报错的代码(比如除零)。 | 卡片标为失败,模型自行修正;Kernel # 不变(内核没死)。 | rc.3 |
| 3.5 | Python 运行与内核 | 让它 print 3000 行。 | 输出折叠/截断;界面不卡。 | rc.3 |
| 4.1 | R 运行 | "用 R 读同一个 CSV(readr/haven),summary 一下。" | `run_r` 显示 Success;tidyverse 函数可用。 | rc.3 |
| 4.2 | R 运行 | 接着:"用刚才那个 R 对象画直方图。" | R 变量跨轮持久;ggplot2 出图,成果出现在详情面板里。 | rc.3 |
| 4.3 | R 运行 | 同一会话里,让一次 R 运行读取按相对文件名指定的工作区文件并出图。 | R 的运行同样能通过 `SCIENCE_WORKSPACE_DIR` 读工作区;`ggsave()` 出的图正常被捕获。 | rc.4 |
| 5.1 | 成果与图表编辑 | Python:"用 matplotlib 画分组柱状图,图例标签写成 `对照组\n(n=30)` 和 `干预组\n(n=28)`(带换行),再加一段两行的注释。"点开成果。 | 图下方有编辑面板(Title/Font/Panel…)和"框选编辑区域"按钮。 | rc.3 |
| 5.2 | 成果与图表编辑 | R:"用 ggplot2 画同样的图,图例标签同样带换行。"点开成果。 | 出现同样的编辑面板。 | rc.3 |
| 5.3 | 成果与图表编辑 | 在编辑面板里改字号(比如 12 → 15),预览后提交为新版本;切到新版本再看一次字号控件。 | 出现 v2,工具栏的 `‹ v2 ›` 步进器能在版本间切换,v1 仍可查看;v2 的字号控件显示的是新字号,不是回到原来的字号。 | rc.3 |
| 5.4 | 成果与图表编辑 | 点"框选编辑区域",拖出一块区域,添加为引用,再在聊天里说"把这块的颜色换成蓝色"。 | 聊天输入框出现引用芯片;模型带着这块区域引用改图,产生新版本。 | rc.3 |
| 5.5 | 成果与图表编辑 | 说:"给这张图起个标题和一句说明。" | 走 `annotate_artifact`;成果卡片的标题/说明随之更新;显示的生成时间保持原运行时间——改标题不会改动它。 | rc.3 |
| 5.6 | 成果与图表编辑 | 用成果工具栏对一张 PNG 和一个 CSV 分别执行 Export/下载。 | 文件落到下载目录,且能正常打开。 | rc.3 |
| 5.7 | 成果与图表编辑 | 在成果库里用搜索框、Newest 排序、Grid/List、按会话分组和 Project files 标签。 | 都有响应;Project files 能看到工作区的文件。 | rc.3 |
| 5.8 | 成果与图表编辑 | 让模型把同一个文件名的图重画两次。 | 同一成果串成 v1/v2/v3 一条链,不是三个独立成果。 | rc.3 |
| 5.9 | 成果与图表编辑 | 让模型给一个不存在的成果名做 annotate(比如"给 nothing.png 加标题")。 | 结果给出明确的 `ARTIFACT_NOT_FOUND` 说明而不是挂死;模型不反复重试。 | rc.4 |
| 6.1 | 轨迹与会话 | 切到 Trajectory 标签。 | 按步骤显示卡片(运行/浏览/整理…);点击卡片能跳到对应消息。 | rc.3 |
| 6.2 | 轨迹与会话 | 点 Session log 导出。 | 得到一个日志文件。 | rc.3 |
| 6.3 | 轨迹与会话 | 完全退出应用再打开,进入同一会话。 | 消息、成果、图表版本都在;轮次/步骤计数和退出前一致,是从会话自身的轨迹索引重建的,不取决于当前加载了哪些页;继续对话时内核重启(新的 Kernel #),并提示早先的变量已经不在。 | rc.3 |
| 6.4 | 轨迹与会话 | 开一个新会话说两句。 | 侧栏标题自动生成。 | rc.3 |
| 6.5 | 轨迹与会话 | 在成果库里对一张图点"另存为副本",然后把对话继续到下一轮;查看 Trajectory。 | 副本按保存时那一刻归到对应轮次;不出现"absent from the loaded conversation"这类横幅。 | rc.4 |
| 7.1 | 联网、文献、Plan、Skill | "pandas 2.3 的 DataFrame.map 文档在哪?" | 模型调用 `web_search`/`web_fetch`,回答附带来源 URL。 | rc.3 |
| 7.2 | 联网、文献、Plan、Skill | "列出你所有 mcp__ 开头的工具名。" | 恰好是已配置的 papers/arXiv 工具集合(一个白名单数量),不是底层 MCP 服务器暴露的全部工具。 | rc.3 |
| 7.3 | 联网、文献、Plan、Skill | "用 PubMed 找 2022 年后关于 ICU 谵妄非药物干预的三篇 RCT,给标题、期刊、DOI。" | 调用 PubMed 的 MCP 工具,结果带 DOI;年份过滤应当精确,不应过宽。 | rc.3 |
| 7.4 | 联网、文献、Plan、Skill | "找一篇 2024 年 arXiv 上关于 diffusion 加速采样的论文,摘出方法一节并导出 BibTeX。" | 调用 arXiv MCP 工具的章节抽取和引文导出功能。 | rc.3 |
| 7.5 | 联网、文献、Plan、Skill | 输入 `/plan` 加"清洗这份 CSV → 拟合线性回归 → 画预测-实际图"。 | 出现 Plan 审核卡片,批准后按步骤执行;呈现出的勘察量应当与任务相称。 | rc.3 |
| 7.6 | 联网、文献、Plan、Skill | "按出版级规范画一张分组箱线图。" | 模型先加载 `scientific-visualization` skill 再写代码(工具调用日志里可见);如果它写了图却没声明 `raster_artifacts`,运行结果会立即说明并点名确切的恢复调用,而不是让模型对未捕获的文件连续两次 annotate 都失败。 | rc.3 |
| 7.7 | 联网、文献、Plan、Skill | "这两组数据该用什么检验,写一段结果。" | 模型依次用 `statistical-analysis` 和 `scientific-writing` 两个 skill;不应在未经确认的情况下装包。 | rc.3 |
| 7.8 | 联网、文献、Plan、Skill | "派一个子 agent 用 Python 算 1 到 100 的平方和并报告。" | 出现 subagent 工具步和 "1 subagent" 标记;子 agent 用自己的内核算出 338350 并报告;父 agent 复核。 | rc.3 |
| 7.9 | 联网、文献、Plan、Skill | "派一个子 agent,让它把自己的全部工具名原样列出来。" | 十来个工具:`run_python`/`run_r`/`get_science_state`/`annotate_artifact`/`read`/`glob`/`grep`/`skill`/`todo_write`/`web_search`/`web_fetch`/`report`;没有 shell、写文件、装包或 `subagent` 工具。 | rc.3 |
| 8.1 | 装包 | "安装 pingouin。" | `install_science_packages` 成功(走 TUNA 镜像);结果说明下次运行会重启内核;那次运行之后 Kernel # 增加,`import pingouin` 可用。 | rc.3 |
| 8.2 | 装包 | "安装 pip-nonexistent-xyz。" | 失败信息明确说明环境未改动、模型不应回退到 `pip install`;一个真正不存在的包应当尽快失败,而不是被镜像的 TLS 握手超时盖住。 | rc.3 |
| 8.3 | 装包 | "安装 R 包 ggrepel。" | micromamba 安装 `r-ggrepel`;成功后 R 能 `library(ggrepel)`。 | rc.3 |
| 9.1 | 设置与恢复 | Settings → Models:在 V4-Flash 和 V4-Flash-Vision-Exp 之间切换。 | 切换即刻生效;输入框旁边的模型名随之变化(这个控件刻意放在composer旁边,不在 Settings 页面里)。 | rc.3 |
| 9.2 | 设置与恢复 | 用应用菜单的 Restart Host。 | Host 重启并回到当前会话,不丢东西;onboarding 或 Change Environment 打开时该菜单项变灰不可点。 | rc.3 |
| 9.3 | 设置与恢复 | 用活动监视器强制结束 PaperMachine,再重新打开。 | 没有损坏提示;会话完整;`host.log` 里能看到上一次退出的记录。 | rc.3 |
| 9.4 | 设置与恢复 | 断网后问一个需要联网的问题。 | `web_search`/MCP 调用报出明确错误;界面不挂死。 | rc.3 |
| 9.5 | 设置与恢复 | 打开 Change Environment…,页面显示期间查看应用菜单的 Restart Host。 | onboarding 打开期间 Restart Host 变灰不可点;选择"Keep current environment"回到工作台后恢复可点。 | rc.4 |
