# Agent Note: 插件激活前的主题引导

Status: implemented

[English](2026-08-10-pre-plugin-theme-bootstrap.md) | 中文

## 问题

Web 壳在浏览器侧插件树激活前呈现 `Loading plugins…`。ui-theme 的 token 样式随动态客户端 bundle 到达，因此不依赖框架的加载页使用私有的明暗回退配色。如果不提前写入 `color-scheme` 与 `body[data-ds-dark-theme]`，持久化偏好为深色时，该页面仍会先按浅色回退绘制，再在 ui-theme 的 ThemeRuntime 与 ui-layout 的 ThemePresenter 激活后切为深色。

`dshClient.immediately` 只把 bundle 纳入第一阶段预取，不会让插件在 HTML 解析或壳首次渲染前执行。仅调整客户端插件的加载档位无法关闭这段时间窗口。

## 决策

ui-theme 的主机侧以一条 body 定位的 script 行（`bootThemeInjection`）回应每次 `webserver/index-inject` 收集，`renderIndex` 把它渲染为 `<body>` 起始标签后紧接的一段同步内联脚本。订阅是无条件的——没有 web server 的组合根本不会 emit 该事件，ui-theme 照常激活且不贡献任何行。HTML 解析器执行该脚本时，body 已存在，而壳的模块脚本与不依赖框架的启动页尚未运行。

settings provider 存在时，主机侧会注册 [`ui-theme.preference` settings 分节](2026-08-06-host-backed-web-preferences.zh.md)。它为每份 index 响应把经过 schema 校验的内建偏好嵌入内联脚本；不存在 settings provider 或有效注册时则嵌入默认值 `system`。浏览器通过 `prefers-color-scheme` 解析 `system`，不支持 `matchMedia` 时回退为浅色。脚本只写 ThemePresenter 后续拥有的两项 DOM 状态：`document.documentElement.style.colorScheme` 与 `body[data-ds-dark-theme]`。

引导逻辑只认识内建的 `light`、`dark`、`system` 语义，不注册监听器，也不解析第三方主题或 token 覆盖。浏览器侧插件树激活后，ThemeRuntime 仍是主题状态的权威来源，ThemePresenter 会把完整解析结果重新写入同一组 DOM 状态并负责后续更新与释放。

Electron 工作台窗口另行依据同一个持久化 `ui-theme.preference` 解析不透明的文档加载前背景——在窗口创建之前直接读取 `<dshHome>/settings.yaml`(`apps/desktop/src/window-theme.ts` 的 `resolveWindowThemePreference`;文件缺失、YAML 无法解析、或字段是这段读取不认识的值,一律回落到 `system`——这段读取只是绘制背景色的装饰性操作,该文档真正的失败即报校验属于 Host 自己的 settings-file 加载)。显式的 `light`/`dark` 偏好会无条件按该颜色绘制,不论系统主题为何,也不订阅 `nativeTheme`;只有 `system`(或偏好未解析出来)才回落到 `nativeTheme.shouldUseDarkColors`,并在 `nativeTheme` 的 `updated` 事件时更新。浏览器仍负责解析用户的 `ui-theme.preference`;原生背景只用于避免 Chromium 绘制 Web 壳前出现错误颜色的闪烁——如果无条件按 `nativeTheme` 绘制,当偏好是 `light`/`dark` 且与系统主题不同时,反而会引入这种闪烁。

## 验证

ui-theme 的单元测试覆盖不含任一可选 Host 服务时的激活、脚本位置、Host 设置优先级、系统偏好、缺少 `matchMedia`、不含 body 的输入、实时读取 settings，以及 Host 注册随插件 fiber 一同释放。真实 Web 组合的 Chromium 场景会选择持久化深色偏好并拦住插件 bundle 请求，使加载页保持可观察，再断言 index 响应产生了深色背景、body 属性和根元素 `color-scheme`。该变化不改变可访问性树，因此不产生新的页面 golden。`apps/desktop/tests/window-theme.spec.ts` 单独覆盖 Electron 窗口自己的解析：每种显式偏好都不论系统主题绘制对应背景、`system` 跟随系统主题,以及 `resolveWindowThemePreference` 读取 `settings.yaml` 回落到 `system` 的每种情形(文件缺失、YAML 非法、缺少分节、值不可识别、文档非 map)。

## 考虑过的替代方案

**把逻辑固定写进 `apps/web/index.html`。** 这样能在相同时机执行，但静态 HTML 无法嵌入当前 Host 设置，还会复制 ui-theme 拥有的偏好解析和 DOM 字段；Host 转换会跟随主题插件的生命周期，并让应用壳无需了解主题领域。

**让 ui-theme 客户端 bundle 同步或更早激活。** `immediately` 只控制预取，插件实例化仍发生在壳开始运行之后；把首次渲染阻塞到 ThemeRuntime 激活会延后可见的加载与报错界面，也会让壳的故障呈现依赖被它监测的插件树。

**只依赖 `prefers-color-scheme` 的 CSS。** 媒体查询无法读取显式持久化选择，因此操作系统为浅色而用户选择深色时仍会闪烁。

**在 `<head>` 中执行并给 html 添加临时类。** body 此时尚不存在，还需要一套与正式调色板属性不同的临时选择器。紧接 `<body>` 是能够直接写正式 DOM 字段的最早解析位置。

## 后果

加载页首帧与持久化内建偏好一致；未组合 settings provider 时则默认采用系统偏好。Electron 窗口背景在文档绘制前就与持久化 `ui-theme.preference` 一致;只有该偏好是 `system` 或未解析出来时,才会跟随原生系统主题,包括操作系统主题变化期间。如果实机报告说切换系统主题后页面自身颜色没变,而应用内 Appearance 设置此时明确是 `light` 或 `dark` 而非 `system`,那是预期行为而非缺陷——页面(`boot-theme.ts`)和窗口背景当时遵守的正是这个偏好;把 Appearance 改成 System 才会让两者都跟随系统主题。index 转换会为每份响应读取 Host settings，而内联脚本只包含选定的内建值与 `system` 解析逻辑。内建偏好语义或 ThemePresenter DOM 字段变化时，必须同时更新脚本与 ThemeRuntime。自定义主题仍会在浏览器插件激活后才完整应用；加载期间，页面使用自己的浅色或深色回退配色。
