# Agent Note: PaperMachine 完全拥有自己的环境

Status: implemented

[English](2026-09-01-desktop-owns-its-environment.md) | 中文

## 问题

研究桌面不能一边承诺可重现起始环境，一边静默采用用户现有 Conda，或依赖唯一且可能无法访问的包源。

## 决策

产品安装并拥有自己的环境。ProductEnvironment 向 provisioner 提供内置 micromamba 路径、general-environment 声明及有序包源，再生成 Science runtime 配置。每次尝试选择完整源；失败后按声明顺序切换并保留诊断。Locale 选择合适默认顺序，但不是解释器身份的一部分。

原生桌面启动和 IPC 拥有设置交互，共享产品路径选择拥有安装隔离。已应用状态关联声明内容并须通过健康观察。内置技能使用显式资源 provider，不读取环境默认目录。

## 考虑过的替代方案

**检测并绑定现有环境。** 会引入未知包状态，使支持依赖无关用户安装。

**硬编码一个可访问镜像。** 可达性因部署而异，唯一源可能阻断设置。

**把部分 channel 尝试混成隐藏回退。** 难以重现所选源及其失败。

## 后果

产品为自有环境承担磁盘和 provisioning 成本。有序回退不证明每个源都在所有平台可用。共享 prefix 修改及会话绑定仍由 Runtime 负责；当前原生打包与根目录隔离各有 owner。

## 相关决策

相关 owner：[papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.zh.md); [desktop-bundled-skills](2026-09-01-desktop-bundled-skills.zh.md); [desktop-general-environment](2026-09-01-desktop-general-environment.zh.md); [provisioning-attempt-logs](../bug-fix/2026-09-07-provisioning-attempt-logs.zh.md).
