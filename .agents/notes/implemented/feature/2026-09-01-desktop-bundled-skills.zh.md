# Agent Note: PaperMachine 随应用内置默认 Science skill

Status: implemented

[English](2026-09-01-desktop-bundled-skills.md) | 中文

## 问题

打包应用必须离线提供精选技能，且不能意外导入 Host 默认技能目录。

## 决策

ProductEnvironment 使用产品资源中的 skills 目录注册 bundled-skills provider，并设置 `includeDefaultRoots: false`。打包拥有这些资源，原生桌面 Host 加载生成的环境组装。配置目录是权威，不能依赖偶然的工作目录或用户 home。

## 考虑过的替代方案

**依赖用户安装技能。** 全新安装行为会不同，离线机器也无法补齐。

**合并内置与环境默认目录。** 无关本地技能会静默改变产品宣称的工具指导。

## 后果

技能更新随产品资源交付，并与官方 Harness 数据隔离。产品目录中存在资源不等于对应功能已启用；实际组装注册才是依据。

## 相关决策

相关 owner：[desktop-owns-its-environment](2026-09-01-desktop-owns-its-environment.zh.md); [papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.zh.md).
