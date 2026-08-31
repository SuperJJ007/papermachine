# Agent Note: 跨刷新保留 Details 列；将工作区文件打开错误本地化

Status: implemented

[English](2026-09-01-details-panel-persistence-and-workspace-error-i18n.md) | 中文

## Problem

Science 工作台的实机验收暴露出两个互不相关的缺口。

`createLayoutStore()`（`packages/client/ui-layout/src/client/stores.ts`）没有声明 `persist`，因此所有字段——侧边栏宽度、Details 宽度与开合状态、窄视口那一对——都会在刷新后重置。用户打开 Details 列查看某个成果标签页或项目文件，下一次刷新就会失去这一列：承载已打开工作状态的面板表现得像不承载任何状态。

`WorkspaceFilePreview`（`packages/client/ui-science/src/client/ScienceDetailsView.tsx`）把 host 的英文 `error.message` 原样渲染到中文界面上——「Workspace file exceeds the 2 MiB preview limit.」。而 host 早就为此携带了封闭枚举的 reason：`workspaceFile` 抛出 `WorkspaceReadError`（`NO_WORKSPACE` | `PATH_OUTSIDE_WORKSPACE` | `FILE_TOO_LARGE`，`packages/host/apiproxy/src/api-proxy.ts`），并作为 `science-artifact-error` 的 `details.reason` 送达客户端。

## Decision

layout store 以带版本的键 `dsh.layout.panels.v1` 持久化，并将 `sidebar`、`narrow`、`narrowExpanded` 声明为 `transient`，因此只有 `details` 经由 `localStorage` 往返。两个面板宽度字段之间的持久化是刻意不对称的，与本仓库「并列值优先对称」的一贯偏好相反：Details 是用户主动打开的文档的工作面，产品负责人要求它跨刷新存活；侧边栏是导航 chrome，它刷新即重置的行为由 `apps/web/tests/smoke-real.e2e.ts`（"sidebar drag widens the column and resets across reload"）钉为有意；`narrow`/`narrowExpanded` 是 `AppFrame` 通过 `setNarrow` 喂入的视口断点实时推导值，持久化会让窄视口下捕获的状态泄漏进下一次宽视口加载。`stores.ts` 的 JSDoc 在声明处记录了同一套理由。

`workspaceFileErrorText(error, t)` 对 `science-artifact-error` 类失败按 `details.reason` 分派，将三个 reason 映射到 `library.fileNoWorkspace`、`library.filePathOutside`、`library.fileTooLarge`；reason 缺失或无法识别，以及其他任何错误码，都回落到 `library.fileOpenFailed`。四个 key 在 `zh` 与 `en` 两侧都存在（`locales.ts`），措辞与相邻的 `library.unsupported` 一致——简短、平实、不用堆栈术语——并且用「文件」而非「成果」，因为这里是项目文件预览而非成果查看器。host 的错误文本未改动：它仍然是面向日志和不携带 locale 的调用方的字符串。

## Alternatives considered

**整个 layout store 一起持久化，包括侧边栏。** 已否决：这与 smoke-real 已经钉为产品行为的侧边栏重置断言冲突，且侧边栏是导航 chrome 而非保存下来的工作状态。

**改写 host 的错误文本来实现本地化。** 已否决：host 字符串服务于日志和不携带 locale 的调用方。结构化的 `details.reason` 才是本地化表面应当消费的东西。

**放宽 `ScienceDetailsInjected`，一次性映射全部七处 `setError(result.error.message)`。** 已否决为一次改动：`loadLibrary` 与 `loadWorkspaceFiles` 已经携带 reason，可以用同样手法映射；而 `addArtifactNote`、`removeArtifactNote`、`applyChartOps`、`previewChartOps` 在该接口上只暴露 `{ message }`，尽管底层 Typert `RemoteFailure` 携带 `code`/`details`。这六处目前仍会以英文出现在中文界面上。

**针对报告中「首次打开宽度异常」加防御性 clamp。** 已否决：验收报告称 Details 列首次渲染约在 120–200px，低于它自己的 300px `DETAILS_MIN`，手动拖动后自行恢复。所有写入 `details` 的路径（`openDetails`、`setDetails`，以及 `columns.ts` 的让步链）都 clamp 到 `[DETAILS_MIN, DETAILS_MAX]` 或 `0`，因此没有任何数据路径能产生该宽度。`AppFrame.module.css` 的 `transition: grid-template-columns 0.3s ease-in-out` 会在打开时把该网格轨道从 `0` 动画经过其间的每一个值，处于过渡中途的观察正好能看到，并且它会自行稳定——这与该症状无法按需复现相吻合。没有找到机制就加保险代码，什么也买不到。

## Consequences

对一个原本瞬态的 store 启用持久化改变了测试隔离条件：任何在同一进程内多次装载 `createLayoutStore()`（或装载它的 `AppFrame`）的测试文件，都必须在两次装载之间清空 `localStorage`。`packages/client/ui-layout/tests/app-frame.client.spec.tsx` 正需要这一点，在补上之前它的缩放与折叠断言会失败。

错误映射的 `default` 分支会丢弃本次构建无法识别的 host reason，改用通用文案，因此在 host 新增 `WorkspaceReadError` reason 的维护者要补上对应的客户端分支，或者接受通用回落；该映射并非由构造保证穷尽。

## Testing

`layout-store.client.spec.ts` 覆盖：Details 在第二次 `create()` 后存活而侧边栏与窄视口那一对重置、窄视口那一对从不被写入、存储中携带它们的 payload 在读取时被忽略，以及缺失全部已声明字段的老 payload 能够无异常地恢复。`ScienceDetailsView.client.spec.tsx` 覆盖三个 reason、一个无法识别的 reason、一个缺失的 reason 在两种 locale 下的表现，并断言 host 的英文原文绝不会到达屏幕。
