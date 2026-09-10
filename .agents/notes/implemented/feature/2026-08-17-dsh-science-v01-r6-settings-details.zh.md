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

设置描述包含 `pendingRestart`，由 provider 在脱敏前比较存储值与生效值，Remote 和客户端 scope 保留这个布尔值。仅判断存在性无法区分两个均已配置的秘密值，比较脱敏对象也会丢失该差异。Science 卡片因此使用 Host 的判断，刷新页面保留待重启状态，Host 重启后清除。Provider 回归覆盖秘密值替换与恢复；真实 Web 场景覆盖初始已配置环境、替换、页面刷新和 Host 重启。
