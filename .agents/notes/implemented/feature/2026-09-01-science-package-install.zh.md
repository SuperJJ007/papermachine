# Agent Note: 通过有序 micromamba channel 完成 Science 装包

Status: implemented

[English](2026-09-01-science-package-install.md) | 中文

## 问题

内核本地安装随 epoch 消失，而耐久包安装必须使用部署可达的源，并记录实际变化。

## 决策

`install_science_packages` 委托 Runtime 使用 micromamba 安装到绑定 prefix。有序配置 channel 遵循产品源策略；每次尝试使用所选源，整体操作受安装预算限制。成功安装须重新观察，再报告已应用环境。身份 fingerprint 与包摘要共同区分环境变化和无操作。

无变化成功保留当前 revision，不重启内核。环境变化记录新观察并通过重新绑定生效。超时指导承认包可能部分或全部写入，要求模型先检查状态或尝试导入，再至多重试一次。

## 考虑过的替代方案

**耐久工具使用 pip 或 install.packages。** 会绕过声明的 Conda 源及环境观察；epoch 本地安装是另一功能。

**所有安装固定到 conda-forge 公共域名。** 同一机器可能通过镜像完成 provisioning，后续安装却失败。

**每次 exit-zero 都追加 revision。** 重复安装会在包未变化时重启健康内核。

## 后果

Micromamba 修改会话共享的 prefix。其他会话在下一次运行时检测 Conda history 漂移，不是立即广播。工具没有新增审批门。中断安装不是原子回滚，包清单也不保证外部 pip 修改可重现。

## 相关决策

相关 owner：[science-kernel-stdin-error-and-install-timeout](../bug-fix/2026-09-03-science-kernel-stdin-error-and-install-timeout.zh.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.zh.md); [desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.zh.md).
