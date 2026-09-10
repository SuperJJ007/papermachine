# Agent Note: 桌面端 onboarding 打通了它的安装路径

Status: implemented

[English](2026-09-01-desktop-general-environment.md) | 中文

## 问题

环境就绪应反映声明的包内容，而不是市场版本号或 PATH 上碰巧存在的解释器。

## 决策

产品 general-environment 声明提供解释器和包要求、健康检查、安装器设置及超时。Content revision 跟随声明的有效字节，避免变化后的环境复用无关已应用观察。ProductEnvironment 从同一资源声明构建 Science profile 与 provisioning 输入。

桌面拥有选定产品 home 下的安装，安装环境必须在使用前被观察；存在 prefix 不证明满足当前声明。

## 考虑过的替代方案

**把应用版本当作环境 revision。** 纯 UI 发布会触发无谓工作，独立环境内容变化反而可能遗漏。

**检测并绑定任意 Host 解释器。** 包集合和溯源变为机器相关，也不符合产品仅安装自身环境的策略。

## 后果

声明内容变化可能要求重新 provisioning 或观察。声明不是阻止外部后续修改的通用锁；Runtime 检查共享 prefix 漂移。平台打包验收与通用环境声明是不同工作。

## 相关决策

相关 owner：[desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.zh.md); [science-shared-prefix-drift](../bug-fix/2026-09-06-science-shared-prefix-drift.zh.md).
