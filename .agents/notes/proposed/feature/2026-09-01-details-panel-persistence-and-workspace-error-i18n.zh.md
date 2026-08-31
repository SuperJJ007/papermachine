# Agent Note: Persist the Details panel across reloads; localize workspace-file open errors

Status: proposed

[English](2026-09-01-details-panel-persistence-and-workspace-error-i18n.md) | 中文

## Problem

两处独立的产品缺口来自 Science 的实机验收：

1. `packages/client/ui-layout/src/client/stores.ts` 的布局 store（侧边栏宽度、详情栏宽度/开合、窄视口断点对）没有声明 `persist`。每个字段都会在刷新后重置，于是用户打开详情栏查看某个成果标签页或项目文件后，下次刷新就会丢失，得重新点开——这个本该承载用户已打开工作状态的面板，表现得像完全不记得任何状态。
2. `packages/host/apiproxy/src/api-proxy.ts` 的 `workspaceFile` RPC 会抛出一个封闭三值枚举的 `WorkspaceReadError`（`NO_WORKSPACE` | `PATH_OUTSIDE_WORKSPACE` | `FILE_TOO_LARGE`），以 `science-artifact-error` 的 `details.reason` 形式传给客户端，但 `packages/client/ui-science/src/client/ScienceDetailsView.tsx` 的 `WorkspaceFilePreview` 直接把 host 的英文原文 `error.message`（例如 "Workspace file exceeds the 2 MiB preview limit."）渲染到了中文界面上。

## Proposal

**只持久化详情栏。** 给 `createLayoutStore()` 加一个带版本号的 `persist` key（`dsh.layout.panels.v1`），让状态经由既有的 `client/runtime` 快照 store 引擎（`attachPersistence`，在 `init()` 上做顶层 merge）跨刷新往返 `localStorage`。将 `sidebar`、`narrow`、`narrowExpanded` 声明为 `transient`，使只有 `details`（宽度/开合偏好）会被写入并读回——这次持久化在两个面板宽度字段之间是刻意不对称的，与本仓库「优先对称」的一般约定相反：

- **详情栏持久化**：它是承载用户主动打开的文档的工作面——成果标签页、项目文件——用户明确要求这部分状态跨刷新保留。
- **侧边栏保持瞬时**：它是导航 chrome，不是要保存的工作状态，且 `apps/web/tests/smoke-real.e2e.ts`（「sidebar drag widens the column and resets across reload」）已经把它「刷新后重置」的行为定为有意为之；持久化侧边栏会与这条既有覆盖相矛盾。
- **`narrow`/`narrowExpanded` 保持瞬时**：它们是当前视口断点的实时推导值（由 `AppFrame` 的 `setNarrow` 驱动），从来不是要保存的偏好——持久化它们会让窄视口下捕获的状态污染下一次宽视口加载。

这个不对称的理由记在 `stores.ts` 里 `createLayoutStore()` 的 JSDoc 中，不只写在本文档里。

**调查过但未复现**：一份实机验收记录报告称，刷新后详情栏第一次打开时，宽度会明显渲染错误（大约 120–200px，低于面板自身 300px 的 `DETAILS_MIN` 下限），要手动拖一下才会自行纠正。追踪每一条设置 `details` 的路径（`openDetails`、`setDetails`，以及 `columns.ts` 里 `computeColumns` 的三步让步链）后发现，每一条都会 clamp 到 `[DETAILS_MIN, DETAILS_MAX]` 区间或者 `0`——没有任何代码路径能产生一个低于 `DETAILS_MIN` 的打开宽度。唯一找到的、能在视觉上呈现出该区间中间值的机制,是 `AppFrame.module.css` 里的 `transition: grid-template-columns 0.3s ease-in-out`：打开详情栏时,网格轨道会从 `0` 动画过渡到解析后的宽度,因此在过渡过程中截屏或观察,会经过中间的每一个值,包括 120–200px,并且会在无需任何交互的情况下自行收敛到正确宽度。这与原始报告无法按需复现的事实是吻合的。针对这条报告没有加任何防御性代码：本次改动的任务书明确要求在没有找到产生机制之前不要加保险代码，而在宽度计算与 clamp 逻辑里也确实没有找到——只有这一个无害、会自行收敛的渲染层面解释。

**按 reason 映射本地化项目文件打开错误。** `ScienceDetailsView.tsx` 新增 `workspaceFileErrorText(error, t)`：当 `error.code === 'science-artifact-error'` 时读取 `error.details.reason`，并对三个已知的 `WorkspaceReadError` reason 分别 switch；reason 缺失或未识别（本 build 尚不认识的未来 host 值，或任何其他 error code）时回落到一条通用的本地化提示。`WorkspaceFilePreview` 里唯一的 `setError(result.error.message)` 调用点改成 `setError(workspaceFileErrorText(result.error, t))`。`science` 命名空间在 `zh` 与 `en`（`locales.ts`）两侧各新增四个 key（`library.fileNoWorkspace`、`library.filePathOutside`、`library.fileTooLarge`、`library.fileOpenFailed`），措辞对齐现有 `library.unsupported` 的语气（简短、平实、不带技术堆栈味），并且统一使用「文件」而非「成果」——因为这是项目文件预览，不是成果查看器。host 的 `WorkspaceReadError` 文本本身未改动——它继续服务于日志与非本地化调用方；改动的只是客户端如何渲染它。

同一文件里另外 6 处 `setError(result.error.message)` 调用点已调查，本轮**有意保留不改**（详见对应 commit 报告里的表格）。其中两处（`loadLibrary`、`loadWorkspaceFiles`）今天就已经带有 `details.reason` 字符串、可以用同样方式映射；另外四处（`addArtifactNote`、`removeArtifactNote`、`applyChartOps`、`previewChartOps`）在 `ScienceDetailsInjected` 接口上只暴露 `{ message: string }`，尽管底层的 Typert `RemoteFailure` 其实带有 `code`/`details`（`ScienceEditErrorCode`）——要映射这四处，需要先放宽这个接口类型。

## Alternatives considered

- **持久化整个布局 store（含侧边栏）。** 否决：这会与既有的、有意保留的 `apps/web/tests/smoke-real.e2e.ts` 侧边栏重置断言相矛盾，也违背侧边栏「导航 chrome 而非已保存工作状态」的定位。
- **用一个不带版本号的 persist key。** 否决，改用本仓库既有的带版本后缀约定（`dsh.science.selection.v1`、`dsh.workspace.view.v5`），这样未来 `LayoutState` 的结构性变化可以直接换后缀，而不必就地兼容旧形状。
- **用查找对象而不是 `switch` 来映射项目文件错误文案。** 否决：本仓库对封闭判别集的约定是用 `switch`，这里的 `default` 分支专门写明了它覆盖的范围（reason 缺失/未识别，以及非 `science-artifact-error` 的失败），符合该约定。
- **一次性放宽 `ScienceDetailsInjected`，让全部 7 处 `setError` 调用点都能拿到 `code`/`details`。** 否决为本轮范围之外：任务书把本次修复范围限定在唯一已复现、已上报的英文残留（`WorkspaceFilePreview`），其余 6 处要求本轮只调查不改。
- **为报告中「首次打开宽度错误」这条症状加一个防御性下限/clamp。** 否决：在宽度计算或 clamp 代码里没有找到能复现该症状的机制，而本次改动的任务书明确否决了在没有找到机制之前加保险代码。

## Acceptance criteria

- 详情栏的开合状态与拖动后的宽度能跨刷新保留；侧边栏宽度与窄视口字段则不会。
- 一份缺少本 build 已声明字段的旧/不完整 payload 能正常 rehydrate 而不抛异常，缺失字段保留 `init()` 的值。
- 一份携带 `narrow`/`narrowExpanded` 值的 payload 在 rehydration 时永远不会被读回实时 store，且这两个字段永远不会被写入 storage。
- 三个 `WorkspaceReadError` reason 各自、以及 reason 缺失/未识别的情况，在 `zh` 与 `en` 下都渲染出各自独立的本地化提示；host 的英文原文 `error.message` 在该调用点上永远不会出现在屏幕上。
- `pnpm run typecheck` 以及受影响包（`ui-layout`、`ui-science`）的单测通过。

## Risks

- 给一个此前瞬时的 store 打开持久化，会改变依赖它的测试隔离假设：任何在同一进程内多次挂载 `createLayoutStore()`（或挂载它的 `AppFrame`）而不在挂载之间清空 `localStorage` 的测试文件都会受影响；`packages/client/ui-layout/tests/app-frame.client.spec.tsx` 因此需要在 `beforeEach` 里加上 `localStorage.clear()`，未来同类测试文件也需要照做。
- 项目文件错误映射的 `default` 回落分支，会有意丢弃本 build 不认识的 host reason（包括未来新增的 reason 值），统一回落成通用提示；后续如果 host 端新增 `WorkspaceReadError` 的 reason，维护者需要在客户端补上对应分支（或接受回落到通用提示），不能假定这份映射天然穷尽。
