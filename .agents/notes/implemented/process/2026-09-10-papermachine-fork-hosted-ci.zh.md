# Agent Note: PaperMachine fork CI on standard hosted runners

Status: implemented

[English](2026-09-10-papermachine-fork-hosted-ci.md) | 中文

## 问题

上游 CI 的 runner 池和备用机器对 PaperMachine 不可用。将这些选择器带入 fork 可能让必需检查无限排队，其并发预算也假定了普通托管 runner 不具备的容量。Science 还需要真实 Python/R 检查，而遥测接收端测试使用 Node 测试运行器，不属于 Vitest。

## 决策

[拉取请求 CI](../../../../.github/workflows/ci.yml) 和[合并后 CI](../../../../.github/workflows/ci-master.yml) 使用普通 GitHub 托管 runner。Linux 静态检查、覆盖率和产物任务限制并发；Windows 任务使用原生 PowerShell。这两个工作流不包含企业 failover 选择器、持久 runner 配置、备用演练或大型 runner 容量基准。fork 没有由操作者选择的备用池。

必需检查结论保留现有 Linux、Node 兼容性、Python x64 运行时、Windows 构建和 Windows 原生测试输入。Windows 覆盖率和观察性检查保留现有独立状态。新增 Science 任务同样独立报告：失败保持可见，但在平台验收之前不成为新的必需检查。合并后的 Python ARM64/macOS 与 Wine 任务也接受手动触发；原有禁用的 macOS 串行任务继续禁用。

Science 任务从桌面资源清单读取固定版本的 micromamba URL 和 SHA256。环境缓存键与创建命令共用 `.github/science-ci-spec.txt`。Windows 短前缀容纳 conda-forge R 包路径。显式选择 `DSH_SCIENCE_REAL_PREFIX`，防止环境配置不完整时悄然使用其他解释器。配置失败后测试仍可执行，工作流取消后则停止。

[门禁运行器](../../../../scripts/run-gates.ts) 在覆盖率聚合中包含 `telemetry-receivers-test`。它直接调用当前 Node 可执行文件与接收端测试 glob，无需构建或包管理器安装。因此，必需 Linux 覆盖率任务会运行这些原本无法发现的测试。原生 Windows 完整验证继承同一叶子及其现有构建顺序。接收端测试使用本地夹具；本决策不增加部署或遥测上报。

本笔记负责 fork 两个 CI 工作流的 runner 分配，替代[failover 操作手册](2026-07-26-ci-failover-runbook.zh.md)、[Node 兼容性决策](2026-09-06-node-compatibility-selfhosted.zh.md)和[串行参考决策](2026-07-21-serial-cross-platform-ci-reference.zh.md)中针对它们的池选择规定。发布与仓库管理工作流仍由各自的文档负责。

## 考虑过的替代方案

**保留企业选择器和备用演练。** 这些标签指向 fork 不具备的基础设施；降低并发预算无法使这些机器可用。

**只在工作流步骤中运行遥测测试。** 这样本地覆盖率聚合仍无法发现 Node 测试套件。使用一个聚合叶子可以让本地与必需 CI 的执行一致。

**立即将 Science 任务设为必需。** 平台适配与真实 Windows 验收属于独立工作。独立任务保留失败证据，同时不声称验收已经完成。

## 后果

fork 避免了对私有 runner 容量的依赖，同时放弃了 failover 机制。普通托管资源的执行时间可能更长；降低后的预算属于配置选择，并非平台验收的测量结果。Science 环境安装、真实 Windows 执行与发布产物仍需平台验证。

CI 工作流规格测试约束 runner 标签、必需依赖、Science 环境选择和取消行为。门禁运行器规格测试验证遥测叶子的纳入情况，通过真实叶子执行接收端测试，并拒绝缺失的测试套件。这些测试验证配置与本地执行，不能替代一次完成的 GitHub Actions 运行。
