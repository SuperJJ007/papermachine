# Agent Note: 跨刷新保留 Details 列；将工作区文件打开错误本地化

Status: implemented

[English](2026-09-01-details-panel-persistence-and-workspace-error-i18n.md) | 中文

## Problem

Science 工作台的实机验收暴露出两个互不相关的缺口。

`createLayoutStore()`（`packages/client/ui-layout/src/client/stores.ts`）没有声明 `persist`，因此所有字段——侧边栏宽度、Details 宽度与开合状态、窄视口那一对——都会在刷新后重置。用户打开 Details 列查看某个成果标签页或项目文件，下一次刷新就会失去这一列：承载已打开工作状态的面板表现得像不承载任何状态。

`WorkspaceFilePreview`（`packages/client/ui-science/src/client/ScienceDetailsView.tsx`）把 host 的英文 `error.message` 原样渲染到中文界面上——「Workspace file exceeds the 2 MiB preview limit.」。而 host 早就为此携带了封闭枚举的 reason：`workspaceFile` 抛出 `WorkspaceReadError`（`NO_WORKSPACE` | `PATH_OUTSIDE_WORKSPACE` | `FILE_TOO_LARGE`，`packages/host/apiproxy/src/api-proxy.ts`），并作为 `science-artifact-error` 的 `details.reason` 送达客户端。同一文件里 `loadLibrary` 与 `loadWorkspaceFiles` 处理器（同一个 `ProjectLibrary` 组件）为成果库和项目文件列表把同一个 host 的英文 `error.message` 原样渲染出来——这是余下两处走同一条结构化 api-proxy 路径的 `setError(result.error.message)`。

## Decision

layout store 以带版本的键 `dsh.layout.panels.v1` 持久化，并将 `sidebar`、`narrow`、`narrowExpanded` 声明为 `transient`，因此只有 `details` 经由 `localStorage` 往返。两个面板宽度字段之间的持久化是刻意不对称的，与本仓库「并列值优先对称」的一贯偏好相反：Details 是用户主动打开的文档的工作面，产品负责人要求它跨刷新存活；侧边栏是导航 chrome，它刷新即重置的行为由 `apps/web/tests/smoke-real.e2e.ts`（"sidebar drag widens the column and resets across reload"）钉为有意；`narrow`/`narrowExpanded` 是 `AppFrame` 通过 `setNarrow` 喂入的视口断点实时推导值，持久化会让窄视口下捕获的状态泄漏进下一次宽视口加载。`stores.ts` 的 JSDoc 在声明处记录了同一套理由。

`scienceArtifactErrorReason(error)` 为一个 `science-artifact-error` 失败提取 `details.reason`（其他任何错误码都返回 `undefined`），三个函数各自在自己的界面上对它分派。`workspaceFileErrorText(error, t)` 把三个 `WorkspaceReadError` reason 映射到 `library.fileNoWorkspace`、`library.filePathOutside`、`library.fileTooLarge`；reason 缺失或无法识别，以及其他任何错误码，都回落到 `library.fileOpenFailed`。`libraryErrorText(error, t)` 只映射 `NO_WORKSPACE`（`library.libraryNoWorkspace`）——`scienceLibrary`（`api-proxy.ts`）还会把 `ProjectArtifactStoreErrorCode`（`SCHEMA_VERSION_MISMATCH` | `INVALID_MARKER` | `ARTIFACT_NOT_FOUND` | `VERSION_NOT_FOUND` | `BLOB_NOT_FOUND` | `BLOB_CORRUPT`，`packages/science/science-artifact-store/src/errors.ts`）作为同一个 reason 转发出来，但这些存储层错误码没有一个是用户能自己处理的，所以它们连同 `internal` 与任何无法识别的 reason 都回落到 `library.libraryLoadFailed`。`projectFilesErrorText(error, t)` 映射 `NO_WORKSPACE` 与 `PATH_OUTSIDE_WORKSPACE`（`workspaceFiles` 与 `workspaceFile` 共用 `resolveWorkspacePath`，因此二者皆可能出现——但绝不会是 `FILE_TOO_LARGE`，那只在 `workspaceFile` 自己的「是否为文件」检查里才会抛出）到 `library.filesNoWorkspace`/`library.filesPathOutside`，其余一律回落到 `library.filesListFailed`。八个 key 在 `zh` 与 `en` 两侧都存在（`locales.ts`）；文件预览那几个 key 说「文件」（单个项目文件），成果库与列表那几个 key 则说「成果库」/「项目文件列表」，与 `library.home`/`library.files` 既有的用词对齐。host 的错误文本在这三处都未改动：它仍然是面向日志和不携带 locale 的调用方的字符串。

余下四处调用——`addArtifactNote`、`removeArtifactNote`、`applyChartOps`、`previewChartOps`——保持不映射。它们走的是 `ctx.remote.scienceEdits.*`，一条 Typert Remote（`packages/client/ui-science/src/client/index.ts`），不是上面那条 api-proxy 路径。`ScienceEditService`（`packages/science/tool-science/src/edit-message.ts`）在业务拒绝时抛出 `ScienceEditError(message, code)`（`CHART_STALE`、`CHART_NOT_ADDRESSABLE`、`CHART_OP_INVALID`、`SCIENCE_EDIT_TARGET_MISMATCH`、`SCIENCE_EDIT_TARGET_NOT_FOUND`、`SCIENCE_EDIT_INVALID_REQUEST`）——这是一个普通的 `Error` 子类，不是 `TypertLookupFailure`。Gateway 的 `rpcFailure()`（`packages/api/gateway/src/index.ts`）把每一个既非 `RemoteInvocationCancelled` 也非 `TypertLookupFailure` 的错误都转换为 `{ code: 'internal', message: error.message, details: {} }`，因此 `ScienceEditError` 的 `code` 永远不会跨越连接——客户端只能看到 `internal` 和英文 `message`，这一点由既有的 `gateway.client.spec.ts` 对另一个业务拒绝的完全相同折叠行为的覆盖所证实。`ScienceDetailsInjected` 的 `{ readonly message: string }` 失败类型（`ScienceDetailsView.tsx`）是准确的，而不只是过窄：今天客户端侧的映射函数根本没有任何结构化字段可以分派。映射这一组需要 Remote 侧或 Host 侧的改动（见 Alternatives），而不是 Details 视图层的改动，因此推迟，等待关于选哪条路的产品决策。

## Alternatives considered

**整个 layout store 一起持久化，包括侧边栏。** 已否决：这与 smoke-real 已经钉为产品行为的侧边栏重置断言冲突，且侧边栏是导航 chrome 而非保存下来的工作状态。

**改写 host 的错误文本来实现本地化。** 已否决：host 字符串服务于日志和不携带 locale 的调用方。结构化的 `details.reason` 才是本地化表面应当消费的东西。

**把四处 Typert Remote 调用（`addArtifactNote`、`removeArtifactNote`、`applyChartOps`、`previewChartOps`）与另外三处 api-proxy 调用一并映射。** 推迟而非否决：通读 `rpcFailure()`（见 Decision）证实今天没有任何 `ScienceEditErrorCode` 能到达客户端，在先做一次单独的改动之前，客户端根本没有可供分派的东西。给客户端补上这个信号有两条路：（a）让业务拒绝的 `code` 跨过 Remote 连接（放宽 `rpcFailure()` 的转换逻辑，或者像 `TypertLookupFailure` 那样为业务错误码另开一条载体），使 `ScienceEditErrorCode` 能活着到达 `ScienceDetailsInjected`；（b）保留 Remote 侧对 `internal` 的折叠，转而让 Host 在别处附加一个结构化字段（例如把 `ScienceEditError` 的 message 收窄成一个稳定、可解析的前缀，或者为编辑失败另开一条 api-proxy 风格的通道）。两条路都能把具体原因（版本过期、图表不可寻址、操作非法）重新摆到用户面前，而不是一句笼统的「操作失败」——现状恰恰是拿这份信息去换语言一致性；在两条路之间做选择是产品/Remote 设计层面的决定，不是 Details 视图层的决定。

**针对报告中「首次打开宽度异常」加防御性 clamp。** 已否决：验收报告称 Details 列首次渲染约在 120–200px，低于它自己的 300px `DETAILS_MIN`，手动拖动后自行恢复。所有写入 `details` 的路径（`openDetails`、`setDetails`，以及 `columns.ts` 的让步链）都 clamp 到 `[DETAILS_MIN, DETAILS_MAX]` 或 `0`，因此没有任何数据路径能产生该宽度。`AppFrame.module.css` 的 `transition: grid-template-columns 0.3s ease-in-out` 会在打开时把该网格轨道从 `0` 动画经过其间的每一个值，处于过渡中途的观察正好能看到，并且它会自行稳定——这与该症状无法按需复现相吻合。没有找到机制就加保险代码，什么也买不到。

## Consequences

对一个原本瞬态的 store 启用持久化改变了测试隔离条件：任何在同一进程内多次装载 `createLayoutStore()`（或装载它的 `AppFrame`）的测试文件，都必须在两次装载之间清空 `localStorage`。`packages/client/ui-layout/tests/app-frame.client.spec.tsx` 正需要这一点，在补上之前它的缩放与折叠断言会失败。

三个错误映射各自的 `default` 分支都会丢弃本次构建未映射的 host reason（对 `libraryErrorText` 来说，是丢弃整个 `ProjectArtifactStoreErrorCode` 这一族）,改用通用文案，因此在 host 新增 `WorkspaceReadError` 或 `ProjectArtifactStoreErrorCode` 取值的维护者要补上对应的客户端分支，或者接受通用回落；三个映射都并非由构造保证穷尽。四处 Typert Remote 调用在上述推迟的 Remote/Host 改动落地之前会一直保持沉默地通用（英文 `internal` message 被吞掉，用户看不到比「操作失败」更多的细节）——改动 `ScienceEditService` 的维护者不应假定它的 `ScienceEditErrorCode` 今天对用户可见。

## Testing

`layout-store.client.spec.ts` 覆盖：Details 在第二次 `create()` 后存活而侧边栏与窄视口那一对重置、窄视口那一对从不被写入、存储中携带它们的 payload 在读取时被忽略，以及缺失全部已声明字段的老 payload 能够无异常地恢复。`ScienceDetailsView.client.spec.tsx` 覆盖：文件预览的三个 `WorkspaceReadError` reason、一个无法识别的 reason、一个缺失的 reason；成果库的 `NO_WORKSPACE`、一个 `ProjectArtifactStoreErrorCode`（`BLOB_CORRUPT`）、一个无法识别的 reason；文件列表的 `NO_WORKSPACE`、`PATH_OUTSIDE_WORKSPACE`、一个无法识别的 reason；以及成果库与文件列表各一个 `internal` 错误码回落到通用文案的情形——全部覆盖两种 locale，并全部断言 host 的英文原文绝不会到达屏幕。
