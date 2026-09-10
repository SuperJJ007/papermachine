# P5 + P6 执行范围

日期：2026-09-10。起点：`ebb69f86a1`，`replant/0.1.5`。用户要求完成 P5 与 P6，平台适配暂缓，完成后由用户验收。状态：执行中，下面清单不是完成声明。

## P5 桌面

- PaperMachine 品牌、产品版本 0.1.3 与内部 dsh 0.1.5-rc.1 分离；桌面 Host 使用 Science bundle。
- 安全 shell renderer/preload 的首跑与错误页面；首跑界面先于 seed 安装；诊断复制处理失败。
- PaperMachine home 先于桌面路径解析；环境声明、绑定、Conda provisioning、skills、telemetry 与主进程生命周期接通。
- 环境切换与插件/版本事务互斥；激活后写入运行配置；升级保留配置并强制修复客户端模块图。
- 后端退出/宿主退出清理、关闭重开状态与旧格式拒绝验证；保留原用户数据。
- 平台专属签名、Windows 原生运行适配、DMG/NSIS 安装与跨平台矩阵暂缓。现有平台代码保留；本次不声称已完成这部分验收。

## P6 检查、快照与文档

- 九类文档失败、生成器/目录/README 中英文及文档链接收尾。
- 删除空不变量伴随插件的发布与注册，保留 Science Session 的真实数据关系检查。
- Science V3 真实录制会话、manifest 与 replay；Web session/纯 UI expected 按所有者放置并核对旧清单。
- fork CI 使用可用的 hosted runner；保留 Science CI 配置；遥测接收器与 node:test 检查纳入执行路径。
- 普通 Python 可执行文件打包命令修复并验证，不以临时 pnpm wrapper 代替修复。
- Agent Notes 与固定上游归档/自有记录逐项对账；既有归档冻结。
- 运行本地 Linux primary 等价检查集合、覆盖率、浏览器、benchmark、文档与构建检查；记录宿主条件和实际跳过。验证已修改的接受路径能拒绝错误输入。
- 在 fork 跑通本阶段 CI；若权限或配置审批受阻，保留为未完成项，不以本地检查冒充远程结果。
- 完成后进行要求逐项审计，提供可复查的日志和人工验收入口；不替换 main 或发布产品。

## 最新收尾（22:48）

当前 Science Process 请求归属修复已闭合：保留绑定前 turn/end，投影缓存版本 19 重建旧行，请求按 trace 序号归属。250 项相关测试及两个模块四维 100% 覆盖、6 项缓存回放、4 项 Web 严格回放、最终 PaperMachine 构建、lint、34 项等价文档检查均通过。真实验收日志 seq 16 请求归属第二轮；GUI 输入发送也已实际验证。最新完整交接 `/private/tmp/pm-p5-p6-local-closeout.md`，详细日志和剩余项以该交接为准。此更新不把整体 P5/P6 标为完成，也不把旧 seed 说成已包含最新修复。

## 本地验证进度

以下是已执行证据；P5/P6 总体验收尚未完成。日志为本机路径，平台专属跳过不计作通过。

- 静态门禁 47/47，日志 `/tmp/pm-p6-static-recheck.log`。最新重复代码检查扫描 1832 文件、0 clone，日志 `/tmp/pm-p6-duplication-complete.log`。
- 最新 official 构建通过，记录 238 个客户端产物，包含共享回放 harness 修复；日志 `/tmp/pm-p6-build-after-web.log`。最终全仓 lint 通过，日志 `/tmp/pm-p6-lint-complete.log`。
- 40 个 compiled companion、285 个 NodeNext API、14 文件 43 项 built-bin smoke、4 文件 5 项 Node compatibility、publint 已通过；对应日志 `/tmp/pm-p6-built-invariants-final.log`、`/tmp/pm-p6-node-next-final.log`、`/tmp/pm-p6-built-smokes-final.log`、`/tmp/pm-p6-node-compat-final.log`、`/tmp/pm-p6-publint-exit-verified.log`。按后续改动的实际影响复用。
- 完整 built Session 回放 141 通过、2 项缺 pwsh 跳过，日志 `/tmp/pm-p6-snapshot-after-fixes.log`；完整 expected-output 31/31，日志 `/tmp/pm-p6-expected-after-fixes.log`。旧的 30 项回放失败及 2 项 expected 失败已清零，未改写 expected 隐藏错误。
- 完整 Web 首轮 108 文件通过、2 文件失败、1 文件跳过，日志 `/tmp/pm-p6-web-full-final.log`。仅修改两个失败测试文件及 owning note 后，这两个文件全部 27 项通过，日志 `/tmp/pm-p6-web-two-files-verified.log`。产品 runtime 与其余 108 个文件未因此改变，复用其已通过结果；无剩余已知 Web 失败。
- 完整 doc-sync 34/34，日志 `/tmp/pm-p6-doc-sync-complete.log`，包括网站构建、文档类型、目录及双语配对。125 项迁入 Agent Notes 对账与 2772 次哈希比较无异常，证据 `/tmp/pm-p6-notes-audit/reconciliation.json`。
- 桌面后续修复后的等价文档 34 叶全部通过（默认 doc-sync 命令未执行，doc-typecheck 使用已有声明的 contracts-ready/no-emit 路径），日志 `/private/tmp/pm-p6-doc-sync-equivalent.log`。JSDoc 与 duplication 通过。首次 driver 因错误的 pnpm 环境变量触发依赖刷新后已中止，详情 `/private/tmp/pm-p6-doc-gates-post-desktop.md`；最终使用 `pnpm_config_verify_deps_before_run=false`，客户端产物摘要复核未变。
- 性能基准 6 文件、36 项通过；日志 `/tmp/pm-p6-bench-build.log`、`/tmp/pm-p6-bench-final.log`。
- 普通 Python 打包使用 shared-lockfile deploy，统一禁用命令前自动刷新；23 项定向测试通过。实际最新打包退出 0，日志 `/tmp/pm-p6-python-exe-no-source-refresh.log`。部署前后 300 个 workspace、88228 条依赖记录的目录身份、链接、字节及根配置完全一致，日志 `/tmp/pm-p6-deploy-source-final-compare.log`。
- 最终 Python exe、runtime wheel 内及独立 venv 中 exe 哈希一致；checkout 外 installed-wheel 全部 keyless 场景通过，完整 pytest 117 通过、1 项 Windows 专属跳过，6 项真实 carrier 全通过。证据 `/private/tmp/pm-p6-python-consumer-final.md`。
- 完整覆盖率门禁退出 0：1304 文件、22938 项通过，13 文件/135 项按条件跳过；statements、branches、functions、lines 及逐文件覆盖率全部 100%。日志 `/tmp/pm-p6-full-coverage-verified.log`。调用显式指定仓库 pnpm 11.7.0 的 `npm_execpath`；Python 独立进程探测已拆为独立用例并保留默认超时。重型豁免组及 telemetry node:test 已通过且输入未变，复用 `/tmp/pm-p6-full-coverage-recheck.log`。后续桌面构建选择修复另按实际影响补验。

## 尚未闭合的验收

- 隔离 home `/private/tmp/pm-p5-acceptance-20260910/fresh-home` 已实际安装环境，binding 于 18:44:57 写入，Python 3.13.15、R 4.5.3 均可启动；323 个 Conda records，provision 日志以 `Transaction finished` 和 `exit ok` 结束。先前“安装未执行”的记录已过时；本次复用现有环境，未重新安装。开发模式启动 Host 及主界面成功，About 为 PaperMachine 0.1.3（dsh 0.1.5-rc.1）；主界面误用 official 构建的问题已修复：56 项定向测试通过，实际旧产物启动被明确拒绝；PaperMachine root 与 desktop 构建及完整摘要校验通过，GUI 标题及侧栏字标已正确显示。日志 `/tmp/pm-p5-wrong-product-rejected.log`、`/tmp/pm-p5-product-build-final.log`、`/tmp/pm-p5-shell-build-final.log`。
- 真实恢复页验收通过：含空格的隔离 home 触发路径校验，页面正确显示 PaperMachine 无法启动和错误原因，点击复制后显示“诊断信息已复制。”，页面退出按钮结束进程且退出码 0。日志 `/tmp/pm-p5-recovery-gui.log`；未点击更改或重置安装位置。正常桌面 Cmd+Q 同样退出 0，日志 `/tmp/pm-p5-reopen-installed.log`；布局/会话持久化尚待补验。
- Host 管道重复关闭已修复，11 项定向测试通过；实际重建后 Cmd+Q 退出 0，新批次 Host 日志无 EBADF，已知桌面/Host/目录选择器进程均已退出。日志 `/private/tmp/pm-p5-fixed-host-session.log`。Science 成果库可打开并分栏；同 home 重开仅保留右栏打开状态，空会话曾一次丢失分栏/tabs，之后两轮临时诊断重开及移除诊断后的正常产品重开均完整恢复，日志仅各有一次 restore、无 save，根因未定，不能标为已修复。临时诊断已移除，正常产品重建及摘要校验通过，日志 `/tmp/pm-p5-product-build-clean.log`、`/tmp/pm-p5-clean-desktop-acceptance.log`；保留两项生命周期回归；定向 155 项通过、四项覆盖率 100%，证据 `/private/tmp/pm-p5-sidebar-restart-handoff.md`。用户已明确授权验收目录；已通过真实 workspace/create 服务登记工作区，并从 GUI 创建新 Science 会话，目录选择不再阻塞验收。
- 新 Science 任务已实际完成。初次使用系统临时 home 被 Science 私有执行目录校验拒绝，原失败日志保留；隔离 home 复制至 `apps/desktop/.desktop-build/acceptance-20260910/home` 后，经正式 ProductEnvironment.install 在最终路径重建环境、健康检查及绑定退出 0。真实 Desktop Host 会话服务中 Python 3.13.15 与 R 4.5.3 独立求和均为 10，发布折线图，turn 2 以 completed 结束。GUI 实际显示结果表和成果 v1；图表标题编辑提交为 v2；正常退出后重开，同一会话、v2 标题、图像及成果/成果库双栏均完整恢复。证据 `/private/tmp/pm-p5-safe-home.log`、`/private/tmp/pm-p5-science-safe-events.jsonl`、`/private/tmp/pm-p5-science-safe-completion.json`、`/private/tmp/pm-p5-science-result-gui.log`、`/private/tmp/pm-p5-science-restart-gui.log`。这次成功不解释此前一次空会话布局丢失；成果库历史版本按钮禁用是 HEAD 中已有的仅提供 latest 版本逻辑，未归类为新迁移失败。Science 任务提示词通过 Host API 提交；随后另用 GUI 输入并发送短请求，收到精确回复，输入框清空，完整 GUI 输入发送链已通过。
- 当前产品完整 tarball 的未签名本地 seed 已补验：真实 pnpm 离线安装、同版本幂等、缺失 Science 客户端包的自动修复、环境 overlay 字节保留和错误版本拒绝通过，首次安装及修复阶段共 3 次真实 Host 启动/RPC 健康检查通过。首次 seed 因可选 libvips 下载失败而缺包，被升级管理器的 staging health 正确拒绝激活；官方精确依赖补齐并验证后通过。证据 `/private/tmp/pm-p5-local-upgrade-status.md`、`/private/tmp/pm-p5-local-upgrade-verified.log`、`/private/tmp/pm-p5-local-upgrade-resume.log`。这是当前版本真实本地安装/修复证明，不是签名安装包或跨版本 seed 升级证明；prepare-seed 已补充真实 Host 启动检查，核对版本并等待退出、清理隔离主目录；实际移走 libvips 会被拒绝，恢复后通过。3 项进程回归、Host noEmit 类型、定向 lint 和等价文档 34/34 全通过，证据 `/private/tmp/pm-p5-seed-runtime-guard-handoff.md`。
- P3/RC1 的三份真实旧 Science 会话拒绝及原字节保留证据可复用，相关实现未变；不等于完整旧 home 的桌面升级、新会话、退出重开链已验收。开发入口也不证明正式 seed/profile 升级；当前 macOS seed 制备依赖暂缓的签名路径。
- 桌面 telemetry 接线及四份 workflow 修改分别等待此前独立审批；完整本地检查已获明确授权，不替代这些动作的授权。
- 尚未提交、push、运行 fork CI、替换 main 或发布产品。最终仍由用户验收。
