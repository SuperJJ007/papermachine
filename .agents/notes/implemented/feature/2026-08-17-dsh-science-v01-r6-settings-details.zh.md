# Agent Note: Science 设置依赖与生效 profile

Status: implemented

[English](2026-08-17-dsh-science-v01-r6-settings-details.md) | 中文

## 问题

设置可能先于服务加载，已保存的环境配置也可能不同于运行中会话所用 profile。混淆两者会误导用户。

## 决策

设置 provider 通过注入声明服务依赖，不在插件 apply 时仅检查一次服务是否存在。环境 profile 修改需要重启；设置分别显示 saved 与 effective 值并隐藏秘密。Effective 记录描述注册时配置，而不是后来读取的文件。

Science 呈现使用原生侧栏资源与页面。设置的所有权不需要私有 Details 插槽或第二套工作区布局。

## 考虑过的替代方案

**只检查一次服务，缺失时跳过注册。** 插件加载顺序会决定设置区是否出现。

**设置变化时热替换运行环境。** 会静默替换解释器状态并使会话观察失效。

**把原始 saved 配置显示为 effective。** 既可能泄漏秘密，也会把未应用设置显示为已生效。

## 后果

用户可以区分已保存修改与运行中 profile。缺少必需依赖时注册必须明确失败；需要重启不意味着可以丢弃活跃内核。原生布局和读取授权仍由各自 owner 负责。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md); [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md).
