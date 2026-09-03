# PaperMachine

[English](papermachine.md) | 中文

PaperMachine 是基于 DeepSeek Harness 构建的 Science 桌面产品:一个 macOS 优先的 Electron 工作台,面向可复现的 Python/R 分析,配有持久内核、带版本的成果库和可编辑图表。本页按方向描述当前面向研究者的行为;每个方向都链接到拥有该细节的子系统文档或包 README。已知缺口和各版本之间的变化记录在[发布记录](../releases/README.zh.md)里,不在本页。

## 环境安装与镜像

PaperMachine 完全自有其 Python/R 环境:首次启动会打开 onboarding,把随包的 `general` 环境(NumPy、SciPy、pandas、Matplotlib、seaborn、statsmodels、scikit-learn、openpyxl、pyreadstat、PyArrow,以及 R 的 tidyverse 系列)安装进应用自己置备的前缀——它绝不会绑定机器上已有的 conda 系环境。确认面板提供三个包来源,依次作为独立尝试:TUNA 镜像、USTC 镜像、官方 `conda.anaconda.org` 频道;系统时区为 `Asia/Shanghai` 或系统语言为中文时默认选 TUNA,否则默认官方频道,用户可以从三者中任意一个开始。运行中的工作台对 `install_science_packages` 保持同样的有序回退。参见 [apps/desktop/README.md](../../apps/desktop/README.zh.md)("Onboarding 与 environment binding"和"环境声明"两节)。

## Python 与 R 持久内核

每个会话每种语言各有一个持久内核,首次使用时惰性启动:变量、导入和定义在 `run_python`/`run_r` 调用之间留存在内存里,直到内核重启(空闲超时、环境重新绑定、中断升级、崩溃或会话结束),运行结果会在相关时说明重启原因。`install_science_packages` 把包装进已绑定的环境(通过 micromamba),但新包只有在该语言下一次运行时才可导入,那次运行会重启内核。运行的当前目录是不会被捕获的私有暂存区;输出写到 `SCIENCE_ARTIFACT_DIR` 下,需要跨重启保留的状态写到 `SCIENCE_STATE_DIR` 下,工作区文件通过 `SCIENCE_WORKSPACE_DIR` 或绝对路径读取。参见 [science-runtime](../../packages/science/science-runtime/README.zh.md) 与 [Science Runtime](../subsystems/science.zh.md)。

## 成果库与版本

一次运行在 `SCIENCE_ARTIFACT_DIR` 下写出的每个合格文件都会被自动捕获为带版本的成果;`.png` 只有在运行把它列进 `raster_artifacts` 时才会被捕获。Artifacts 面板按产出会话分组展示版本,提供搜索、排序、网格/列表控件,Project files 标签可以直接浏览工作区。打开一个版本会显示它的内容来源和创建时间,以及版本步进器(`‹ vN ›`);"另存为副本"把某个版本复制成一个全新的成果。项目首次打开时,若发现 store 与会话日志不一致,一个非模态的对账横幅会点名这些情况。参见 [science-artifact-store](../../packages/science/science-artifact-store/README.zh.md) 与 [Artifact viewer](../../packages/client/ui-science/README.zh.md#artifact-viewer-details-entry)。

## 图表编辑与区域引用

通过 matplotlib 的 `savefig()`/`plt.savefig()` 或 ggplot2 的 `ggsave()` 保存的 PNG 会带有可寻址的图表投影。查看器的编辑面板为标题、副标题、坐标轴标签、图例位置、网格线和字体提供直接控件,每次保存都会产生新版本;抽取到的每个元素——系列、注释、坐标轴——都作为一行引用列出。点击某行的 `+`/`−`,或在栅格图上拖出一个归一化区域,都会暂存一条引用,随composer的下一条聊天指令一起发送,这样后续编辑指向一个精确目标,而不是一段截图描述。参见 [Artifact viewer](../../packages/client/ui-science/README.zh.md#artifact-viewer-details-entry) 与 [science-runtime](../../packages/science/science-runtime/README.zh.md)("图表可寻址性"一节)。

## Process/Trajectory 视图

对 Science 会话而言,Trajectory 标签默认打开 Process 视图而不是通用的 Detailed 流水账:每个轮次一张卡片,展示用户请求、按顺序排列的步骤条、汇总数字,以及该轮次产出的成果版本;展开后能看到每一步背后的确切代码、参数和 stdout/stderr。内核启动/退出/中断事件渲染为时间线标记,而不是单独的面板。轮次和步骤的归属能在应用完全重启和对话冷加载后保持不变,因为它是从会话自身的持久轨迹索引重建的,而不取决于当前加载了哪些对话页。参见 [ui-science](../../packages/client/ui-science/README.zh.md)("Process view"一节)。

## 文献 MCP 服务器与 Skill

Science 的人格设定会通过工具名约定——`mcp__papers__*` 或 `mcp__arxiv__*`——识别已连接的文献 MCP 服务器,并在文献检索、引文查找或论文全文场景下优先使用它而不是 `web_search`,同时为它依赖的任何内容标注来源;应用本身不随包任何这样的服务器,连接一个属于普通的 [MCP client](../../packages/mcp/mcp-client/README.zh.md) 部署选择。三个 Science skill——`scientific-visualization`、`statistical-analysis`、`scientific-writing`——随桌面构建以只读方式提供,项目自带或用户自己 `~/.papermachine/skills` 下的同名 skill 会盖过它们;agent 会在写相关代码之前通过 `skill` 工具显式加载某个 skill 的说明。参见 [apps/desktop/README.md](../../apps/desktop/README.zh.md)("随应用内置的默认 skill"一节)与 [tool-catalog.md](../tool-catalog.zh.md)。

## 受限子代理

Science 可以通过 `subagent` 工具把一项真正独立的子任务——比如与数据探索并行的文献检索,或者一次可以单独跑很久的探索性分析——委派给一个子代理。子代理启动自己的内核,不带父代理的任何变量,不能装包、不能进一步委派(`maxDepth: 1`)、不能给别的 agent 发消息或列出别的 agent,也不能进入 plan 模式;它把结论、关键数字和每个产出成果的逻辑名汇报给父代理,而父代理自身的人格设定被要求在复述子代理汇报的数字之前先核实一遍。参见 [Science Runtime](../subsystems/science.zh.md) 与[受限子代理的 Agent Note](../../.agents/notes/implemented/feature/2026-09-02-science-restricted-subagent.zh.md)。

## 桌面壳:菜单、Restart Host、Change Environment、host 日志

应用菜单提供 **Restart Host**(⌘⇧R)——在不丢失当前会话的前提下停止并重启 Host 进程——以及 **Change Environment…**——重新打开 onboarding,同时正在运行的 Host 继续服务当前工作区;onboarding 本身已经打开时,两者都会变灰不可点。Change Environment 页面顶部显示当前已应用环境的 id、版本号和状态,当已应用版本与标准声明一致时,主按钮默认是"Reinstall"(注明下载大小),也可以选"Keep current environment"不做改动直接返回。Host 的 stderr 会脱敏、轮转并落盘到 `<Harness 主目录>/logs/host.log`(默认活动文件 5 MiB、轮转保留 2 份);每个错误页都会点名这个路径。参见 [apps/desktop/README.md](../../apps/desktop/README.zh.md)。

## 设置与模型

模型选择就在composer旁边,不在 Settings 页面里:切换立即生效,输入框旁边显示当前模型名。Settings → Plugins → Science 保存着已绑定的 `science` Runtime profile 使用的两个 Conda 前缀(`pythonPrefix`/`rPrefix`);两个字段都是 secret 类型,已保存的值不会回显,改动只在下一次 Host 重启后生效,状态显示为 `effective`/`pendingRestart`/`notConfigured`。API key 只在 onboarding 的 Models 步骤写入一次,经由 credentials 服务完成。参见 [ui-science](../../packages/client/ui-science/README.zh.md)("Settings card"一节)与 [Settings-bound entry](../../packages/science/science-runtime/README.zh.md#settings-bound-entry)。
