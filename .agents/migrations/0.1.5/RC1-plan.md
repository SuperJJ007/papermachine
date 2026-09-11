# PaperMachine 0.1.5 rc.1 基线迁移计划

日期：2026-09-10。状态：已执行；整合结果、验收及剩余阶段见 [RC1 验收记录](RC1.md)。本计划承接 P0–P7 移栽任务，范围是把现有 replant 成果升级到 rc.1，不替代 P5 桌面和 P6/P7 最终验收。

## 固定输入

| 输入 | 固定值 |
| --- | --- |
| 工作目录与分支 | `/Users/superjj/ccproj/pm-replant`，`replant/0.1.5` |
| 原上游基线 | `dsh-v0.1.5-alpha.1`，`5dda764ed3aa172535a7967b06ff95d9cbfe536a` |
| P3 验收提交 | `5561b6e7bb`；详见 [P3](P3.md) |
| P4 完整检查点 | `e901edb5678571b9fe56e22d5d88f6544235241c`，178 文件，+6450/−3110 行 |
| 目标 | `dsh-v0.1.5-rc.1`，`183f08e9c6dde7e36cd2318eaee70b0da08fb35e` |
| 协作约束 | 如使用子 agent，统一 `gpt-6-astra`、`medium`；Git 合并、索引、依赖及生成文件由一个主执行者负责 |

检查点保留全部未提交源码、测试、预期输出及文档，只修正四处文件末尾多余空行，并刷新已同步的 ui-science README 配对记录。正常 pre-commit 的配对、lint、notices、空白与 vendor guard 全部通过。没有运行本次工作树的行为测试，不能据此称 P4 已验收。提交后工作树干净；未推送，未更新 main。

## 已确认的差异

alpha.1 至 rc.1 共 279 个提交（含合并），1506 个文件变化。现有迁移工作与上游变化有 75 个文件重叠。对固定检查点运行隔离的 `git merge-tree --write-tree`，得到 23 个文本冲突文件；[完整清单与命令](evidence/RC1/merge-preview.json)记录输入 SHA。预演只在临时共享对象克隆中写入 Git 对象，未操作产品工作树或索引。

| 冲突组 | 数量 | 处理方法 |
| --- | --- | --- |
| 双语配对记录 | 12 | 先合并并核对正文，再逐对重新记录；不任选一侧哈希 |
| module graph 中英文、slot catalog、API catalog | 4 | 保留生成器的 Science 登记，源代码完成后生成并同步派生内容 |
| Remote manifest 与客户端装配 | 2 | 同时保留 Science Remote 和 rc.1 的 sessionFeedback 装配及依赖 |
| layout 测试、MCP 工具桥 | 2 | 按下方语义适配及回归验证处理 |
| lockfile、Host/base 编译引用 | 3 | 合并有效依赖和引用后由工具生成，禁止整份取旧文件 |

文本自动合并不会发现重复槽位注册、恢复数据结构不匹配、预览授权参数变化和工具清单变化；这些是本次实现和测试的重点。

## 执行顺序

### R1：固定检查点与基线证据

1. 确认 replant 工作树干净，HEAD 包含上述检查点；若有新改动，先保存新的检查点并重新运行预演。
2. 从当前 replant HEAD 新建 `codex/replant-0.1.5-rc1`，将整个 rc.1 tag merge-forward；不重放旧 main，不逐提交 cherry-pick，也不追随浮动的 upstream/master。
3. 为 rc.1 单独准备干净基线工作树。记录 Node/pnpm/Python 实际路径及版本，执行 frozen install、typecheck、build 和本次有关的上游 package tests，作为问题归属依据。当前可用 Node 是 `/Users/superjj/.local/bin/node` v24.14.0；P0/P3 中的临时 Node 目录已不存在，必须重新验证 native headers/build 条件。
4. 合并前可以只读并行审计；合并过程、锁文件、tsconfig 和生成目录禁止多 agent 同写。

### R2：合并源码、依赖与产品组合

执行 `git merge --no-commit --no-ff dsh-v0.1.5-rc.1`，按证据清单解决冲突，并完成 R3/R4 的必要适配后才形成可验收的整合结果。保留 rc.1 的包目录及公开 API；删除上游已替代的旧引用。已有 P2/P3 行为依据各自 Agent Note 保留，不能以整文件选择 ours/theirs 解决。

- 自有包的内部版本跟随 `0.1.5-rc.1`；产品版本仍按原 D2/D8 独立处理，不趁此次基线更新改变发布列车。
- `ui-sidebar-textpreview` 改为 `ui-sidebar-documentpreview`；同步 composition、resolver manifest、编译引用和测试，不保留空壳兼容包。
- Remote 装配同时保留 Science 与 rc.1 的 sessionFeedback。重新生成 Typert、路径、API、slot、persistence 等目录；事件清单同时包含九个 Science 事件及新增 `deliverables/presented`、`subagent/catalog`。
- MCP 工具桥同时保留 P2 的 include/exclude/rename/describe 限制和 rc.1 的分页游标循环拒绝；发现失败时不得部分替换现有注册。覆盖初始发现、重连、list_changed 和循环分页。
- 检查 Science/science-headless 的最终工具清单与 scoped guidance。rc.1 的 `present` 在上游 presets 中装配，不能假定自有 Science preset 自动继承；本次先维持既有 Science 产物事件、版本、编辑和鉴权语义。若需新增 present，必须单独设计事件与 UI 去重及日志重放，不能直接把 Science artifact 当作普通文件交付。
- 跟随 rc.1 的默认 `deepseek-flash` / V41 Flash。历史录制用例显式固定其原模型路由；新真实验收记录实际选中模型，不用修改旧期望掩盖模型不一致。

### R3：适配客户端主布局与持久化

| 位置 | 必须完成的适配 | 回归证据 |
| --- | --- | --- |
| ui-layout / ui-conversation | 接受 `main`、`main.conversation`、`rightbar.session` 及全局主面板导航；更新真实组装 fixture 的旧 conversation 根槽 | 注册成功；切换主面板、工作区、会话后返回正确会话 |
| ui-layout store | 按 rc.1 的 `panelInfo` / `layoutInfo` 重做 rightbar 宽度持久化；旧顶层 transient 列表不能照搬 | 只恢复偏好宽度，不恢复 viewport、展开状态或临时主面板；旧数据按明确 key/version 处理 |
| client store / ui-sidebar-right | 保留必要的 transient 支持、tab layout 持久化和 adopt 后立即同步 resource occurrence；适配新的 seed 工厂、关闭及去重规则 | 刷新后恢复 tab、资源 pin 和宽度；dispose/re-adopt 不泄漏、不串会话 |
| conversation 扩展 | 保留 Science 编辑提交认领、失败保留选择、会话定向 openView/focus；跟随 rc.1 公共会话导航 | 异步操作在切换会话后仍作用于发起会话；普通发送不受影响 |

rc.1 尚未提供与 P4 持久化、恢复同步和编辑提交扩展等价的实现，不应仅因源码能自动合并就删掉这些能力。`ISidebarRight` 新增的 `openResourceIn/openTabIn` 声明则应按真实消费者重新评估：rc.1 Context 已暴露带这些方法的 controller；若没有接口消费者依赖，删除冗余补丁。

### R4：将 Science Library 注册成独立原生页面

P4 使用内建 guide 的标题 key；rc.1 已在同 key 注册 GuideTitle，会导致重复注册。rc.1 同时根据 guide entries 决定默认页，只有 Files 一项时会直接打开 Files。因此仅替换 guide 正文无法稳定提供 Science Library。

- 注册独立 `science-library` page kind、body、title 及 guide entry，删除对内建 GuideTitle 和 guide 正文身份的占用；三个库导航入口改为打开自有 page kind。
- 保留当前会话 header、sidebar footer 和 artifact menu 的库入口；没有会话时不显示会话操作。Library 继续是会话右栏页面，不新增全局 main panel。
- 保留 `science-artifact` 资源身份、版本选择、图表编辑、notes、provenance 和独立灯箱。普通工作区文件交给 rc.1 documentpreview；它不替代 Science 的业务查看器。
- 普通文件地址使用包含所属 sessionId 的 `file/session/...`；不能借当前会话打开旧 `file/absolute/...` 地址。WorkspaceFiles 的 wire 参数改用 `workspaceFileScopeId`，文件资源元数据改为 `WorkspaceFileStat`，失效提示按 version 判断。
- 以 rc.1 的页面去重和默认种子规则为准；为保存的 P4 guide/tab 偏好规定一次性丢弃或明确转换策略，避免盲目恢复旧 guide 作为 Science Library。这里处理的是浏览器布局偏好，不能扩大为历史 Science 日志迁移。

### R5：验证、补丁台账与交接

先跑各自最小行为测试，再跑 assembled Science 用例；通过的检查不因 commit 再重复。失败按“纯 rc.1 基线 / 现有 P4-P6 欠账 / 本次引入”记录，不能把新增失败归入旧账。命令使用实际 rc.1 脚本和发现的测试文件，保存完整 argv、exit、SHA 与日志。

| 验证层 | 本次要求 |
| --- | --- |
| 编译与装配 | frozen install、typecheck、完整 build；路径、Cordis composition、依赖、client catalog、session-format/persistence catalog 检查 |
| 客户端单测 | store、ui-layout、ui-sidebar-right、ui-conversation、ui-science、brand；先聚焦改动行为，再补确有调用关系的相邻测试 |
| Host 单测 | MCP 工具桥、Remote 装配、workspace-files、Science session/tool；P2 runtime 在相关源码未变化时复用既有证据，仅补受新组合影响的测试 |
| 实际浏览器 | 空会话 Library/Files、产物双 pane、版本编辑与失败保留、返回 Chat/Trajectory、切换会话、刷新恢复、md/image/pdf 文件预览；优先现有 science-file-library、science-chart-outcome、science-trace-cold-restore 等用例 |
| 模型/用户输出 | Science 新录制会话遵循顶层 snapshots 归属；现有 owner-local ARIA/布局预期保留各自归属；验证默认模型 route、scoped tools/guidance、交付事件展示和 TS/Python SDK 相关 replay |
| 格式与数据 | 原生 V3 九个 Science 事件 round trip；对三个已知 V0 样本的隔离副本确认仍拒绝且原文件不变；不实现历史恢复、不写已安装用户数据 |
| 真实任务 | 隔离 Harness home 下 science-headless 执行一次 Python 任务，验证 artifact 事件与 blob 哈希；模型不可用时明确记录阻塞，不能宣称通过 |
| 门禁和文档 | lint、duplication、hygiene、doc-sync；本次新增问题全部清零，P6 遗留逐项记账；更新 upstream patch ledger、对应 Agent Note 和双语说明 |

本次不默认运行全仓覆盖率、Windows/Electron 发布矩阵或全量 real-API e2e。P5 保留 desktop、Conda provisioning、签名与 Windows packaged acceptance；P6 保留完整文档/快照收口和普通 Python packaging 命令修复；P7 承担产品最终验收。以上仍未完成时，不得把 rc.1 基线更新表述为 PaperMachine 可发布。

## 提交与完成条件

主执行者负责 merge-forward 与共享文件，必要时把客户端适配和 Host/MCP 回归分别交给 `gpt-6-astra` medium 子 agent，并指定互不重叠的文件所有权。生成物最后串行生成；不要让多个 agent 各自更新 lockfile、tsconfig 或目录快照。

rc.1 tag 必须成为整合 HEAD 的祖先；工作树干净；23 个文本冲突及上述语义适配有结果；每个保留的上游补丁有理由和退出条件；受影响行为、构建及目录检查通过；剩余 P4/P5/P6/P7 工作在交接记录中明确。通过后把整合分支合回 replant 并继续原阶段验收。推送、替换 main 和发布不属于此次规划动作。

## 本次规划证据

已执行：`git fetch upstream --tags`（前一轮）；完整 P4 检查点提交及正常 pre-commit；提交后 `git status --short`；固定 SHA 的 diff、API 静态审计；隔离共享克隆中的 `git merge-tree --write-tree`（exit 1 表示上述预期冲突）。子 agent 使用 gpt-6-astra medium，只读审计客户端。尚未执行 rc.1 合并、依赖安装、编译、行为测试或发布。
