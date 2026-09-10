# PaperMachine rc.1 整合验收

日期：2026-09-10。状态：rc.1 基线整合完成；P5/P6/P7 的产品发布验收仍未完成。本记录随合并提交保存。范围、固定输入和执行顺序见 [RC1 计划](RC1-plan.md)，历史阶段证据见 [P2](P2.md) 与 [P3](P3.md)。

## 合并结果

从 `df03df3e26` 建立 `codex/replant-0.1.5-rc1`，merge-forward 到 `dsh-v0.1.5-rc.1`（`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`）。P4 检查点 `e901edb567` 保留在历史中；未重写旧 main。隔离预演有 23 个文本冲突文件，实际仓库的配对合并工具先解决 11 项，余下 12 项由整合处理。生成目录从合并后的源代码重新生成，依赖锁文件由 pnpm 更新。

- Science Library 使用独立 page kind、标题及 guide entry，不占用上游 Guide。全局主面板中的底部入口先打开所属会话，再打开 Library。
- 采用 rc.1 的 main/conversation 和 layoutInfo/panelInfo 结构；只投影并校验恢复右栏偏好宽度，新版本键丢弃早期浏览器布局。侧栏恢复同步建立资源 occurrence，编辑提交及会话定向导航保留。
- MCP 工具桥同时保留部署过滤与循环游标拒绝；失败不替换上一组工具，恢复后再次应用过滤。Science Remote 与 rc.1 sessionFeedback 并存。
- 自有包内部版本更新为 `0.1.5-rc.1`。普通文件预览复用 documentpreview；Science 仍拥有版本化 artifact、编辑和溯源，不新增 present 工具。
- 事件目录同时保留九个 Science 事件及 rc.1 新事件；默认模型跟随 `deepseek-flash`。历史测试明确固定录制路由。

## 验证结果

准确命令、退出码和日志索引见 [checks.json](evidence/RC1/checks.json)，原始输出保存在 [日志归档](evidence/RC1/validation-logs.tar.gz)。所有通过项都来自实际执行；失败后只重跑受修复影响的检查，没有刷新会话快照来掩盖行为差异。

| 检查 | 结果 |
| --- | --- |
| 纯 rc.1 基线 | frozen install、typecheck、完整 build 通过；六组重点测试 64 文件 / 925 例通过；隔离源码干净 |
| 整合安装、typecheck、build | 最终全部通过；PaperMachine build 记录 238 个 client artifacts |
| lint / duplication | 通过；0 clones |
| constraints / package dependencies | 通过；旧 textpreview 目录仅剩构建和 node_modules 残留，确认无受跟踪文件后删除 |
| MCP、workspace-files、Science session/tool | 35 文件 / 610 例通过，包含 curation 与循环分页组合回归 |
| client store/layout/sidebar/conversation | 首轮四包 48 文件 / 669 例通过；新增持久化和导航回归后五个重点文件 108 例通过 |
| Science UI | 最终 30 文件 / 524 例通过；真实组合另覆盖全局主面板返回 Library |
| Science 浏览器 | cold-restore 通过；file-library 与 chart-outcome 审核新版 UI 后重放 8/8 通过；最终 footer 修复后 file-library 2/2 通过；普通 document-preview 1/1 通过，覆盖 Markdown、图片、PDF |
| SDK / headless 录制会话 | 初轮 110 通过、2 失败、2 条件跳过；API 目录重建和 Python PATH 修正后仅重跑失败两项，2/2 通过；没有修改期望 |
| Python SDK | 四组 replay 通过且预期未变；这是 source SDK + 当前 built CLI，不是 wheel 或单文件可执行体验收，详见 [报告](evidence/RC1/python-replay.json) |
| 真实 Science V0 | 三份原件的隔离副本共六次 read/write 拒绝；原件 hash/inode/mtime 不变、副本不变、无 successor，详见 [证据](evidence/RC1/real-v0.json) |
| 真实 science-headless | 默认 deepseek-official/deepseek-flash 实际成功；run_python 产出 28,148 字节 PNG，事件与磁盘 SHA256 一致，详见 [证据](evidence/RC1/real-headless.json) |
| doc-sync | 25 通过 / 9 失败，仍为 P2/P3 记录的 P6 门禁家族；新增 export JSDoc 问题已修复并通过 |
| hygiene | 初轮 14 通过 / 2 失败；constraints 的旧包残留已修复并通过独立复验，余下为已有 package invariants 问题；未称整套全绿 |

## 失败与修复的归属

纯 rc.1 native 构建首次遇到本机 SDK/linker 不匹配；使用 Node 24.14.0 的官方匹配 headers 与已有 `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk` 后通过。整合 build 使用相同工具链；没有修改产品 native 代码来绕过问题。

整合 typecheck 首轮发现 Science 测试把 Playwright 的 exact 参数传给 Testing Library；修复测试类型后通过。API 目录以源代码重建后必须再次 build，首轮 cordis-inspect-jsdoc 的缺失字段由过期 built catalog 引起，修复构建顺序即可通过。ptc-python-turn 首轮选中系统 Python 3.9.6，PATH 加入 `/opt/miniconda3/bin` 后通过。

浏览器最初的六项差异来自 rc.1 的 More actions、侧栏控制、文件预览 Open with/Line wrap 和 Library 标签顺序；审核实际结果后刷新六份 owner-local UI 预期。最终 file-library 又发现异步授权摘要尚未到达时立即 count 的时序问题，改为轮询相同精确文案和数量；断言未减弱、该次未刷新预期。document-preview 在同轮独立通过。

真实 headless 的外部工作目录需要明确 tsconfig 才能 source launch；临时 Harness home 被已有 scratch-root 规则拒绝，改用新建专用验收 home。Python minimal 两组曾遇到沙箱禁止 `/bin/ps`，仅对失败命令按原参数窄提升后通过。所有真实测试均使用隔离工作目录；既有用户数据只读。

## 仍归原迁移阶段的工作

P6 文档九类失败：doc graphs 缺 Science service role 分类；tool catalog 未登记 tool-science，连带目录锚点缺失；config catalog 对 Science schema 的投影不完整；doc refs、subsystem pages、README Summary/Model Experience 和文档标准测试仍需收口。最终完整错误列表在日志归档中，不能将这些检查标为通过。

package invariants 仍包括 science-app 的缺省 companion 理由，以及 brand、ui-science、artifact-store、runtime、tool-science、attachment-index、byte-size 的旧空 companion。这些是 P2 已记录的 P6 项，未在本次扩大为结构重写。Sidebar 持久化 JSON 仍只有既有顶层检查，完整嵌套 DockKit 校验是明确的 P4 后续限制；新宽度偏好有专属校验。

P5 继续处理 desktop、Conda provisioning、签名及 Windows packaged acceptance；P6 继续处理完整门禁/快照收口和普通 Python packaging 命令；P7 承担最终产品验收。未运行全仓 coverage、Windows 矩阵、安装 wheel 或发布操作。本次只将 rc.1 整合推进回 replant，未推送、未替换 main。
