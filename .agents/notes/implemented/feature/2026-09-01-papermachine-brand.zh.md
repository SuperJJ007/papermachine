# Agent Note: PaperMachine brand as the desktop's slot occupant

Status: implemented

[English](2026-09-01-papermachine-brand.md) | 中文

## 问题

产品品牌需要同步改变标记、名称和首页主视觉，不能 fork 共享客户端或影响官方构建。

## 决策

PaperMachine 品牌插件通过相同的注入 slot 与 locale 服务注册标记、名称和主视觉插槽。注册受 `papermachine` 客户端构建 profile 控制。依赖 locale 的文本由 effect 拥有，dispose 时移除贡献。产品身份及运行时 home 选择与这些视觉插槽分开。

## 考虑过的替代方案

**直接修改共享客户端标签。** 官方构建会获得 fork 专属身份。

**只替换一处品牌。** 导航和首页会描述不同产品。

**只读取一次 locale 且不管理 effect。** 文本可能过期，插件卸载后仍残留贡献。

## 后果

产品通过插件拥有可见品牌。构建 profile 判断不等于运行时安装隔离；产品 app id、存储根和更新来源各有 owner。

## 相关决策

相关 owner：[papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.zh.md).
