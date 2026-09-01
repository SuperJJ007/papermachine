# Agent Note: PaperMachine brand as the desktop's slot occupant

Status: implemented

[English](2026-09-01-papermachine-brand.md) | 中文

## Problem

PaperMachine 的 Electron 外壳（`apps/desktop`）在侧边栏和对话区 Hero 里渲染的一直是 DeepSeek Harness 品牌——鲸鱼标加上 "deepseek-official … HARNESS" 字标——因为它启动的是通用 `dsh-web-app` bundle，除了一个 Runtime overlay 之外未做改动。产品 owner 希望侧边栏与 Hero 字标改为 "PaperMachine"，同时不影响 Web 产品自身的品牌，且暂不重新设计标记——鲸鱼标在 PaperMachine 专属标记出现之前保持不变。

## Decision

这次改名是新增一个 slot occupant，而不是编辑已有的那个。`packages/client/ui-brand-official` 已经以一组声明感知的 `slots.inject()` 注册，填充了三个 `single` 类型的 UI slot（`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`，分别声明于 `packages/client/ui-sidebar` 与 `packages/client/ui-conversation`），并以 `DSH_CLIENT_BUILD_PROFILE === 'official'` 为门控。`packages/client/ui-brand-papermachine` 是逐文件对照该模板新建的包——同样的 `dsh.client` 元数据、同样嵌套的 `inject()` 注册结构、同样的 invariant companion——用 `PaperMachineBrandMark` 与 `PaperMachineBrandName` 填充完全相同的三个 slot。它不带构建 profile 守卫；取而代之的是，挂载它的 `dsh-web-app` bundle 行（`packages/bundle/web-app/cordis.patch.yml`）默认 `disabled: true`，因此该行的单纯存在不会改变 Web 产品的组合。`apps/desktop/src/runtime-overlay.ts` 是唯一会把它打开的一层：渲染出的 overlay 在同一个字符串里禁用 `ui-brand-official` 并启用 `ui-brand-papermachine`，与 overlay 既有的强制 Science、禁用 `hmr` 等行并列。

两行同时启用不是一个合法状态：`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` 都是 `single` 类型 slot，当两个 registrant 以相同优先级瞄准同一个 slot 时，`SlotCore.register` 会抛出 `single slot "…" already has a registration at priority 0`（`packages/client/ui-slots/src/index.ts`）。因此在同一个 overlay 里禁用 `ui-brand-official` 是必须的，不是风格选择——桌面端 overlay 测试（`apps/desktop/tests/runtime-overlay.spec.ts`）钉住了两行各自的 `disabled` 值；而“overlay 只能 patch base bundle 已声明的 id”这条测试，也迫使新行必须先出现在 `cordis.patch.yml` 里，overlay 才能引用它。

`PaperMachineBrandMark` 原样复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `FishLogo`，文档中注明这是等待 PaperMachine 专属标记的占位物。`PaperMachineBrandName` 是全新组件：一个文字字标，而不是美术图形——"PaperMachine" 作为一个词，"Paper" 字重 500、"Machine" 字重 700，共用同一个 `var(--dsw-alias-label-primary)` 墨色，字距 `-0.01em`，通过宿主操作系统的字体栈渲染（桌面应用离线运行，因此不打包也不拉取字体）。它的 `BrandName.module.css` 盒子在默认 18px 字号下高 24px——与 `BrandWordmark` 在同一个侧边栏 slot、默认尺寸下占据的盒子相同（`includeMark={false}` 在 `size=24` 下渲染，原生高度 24）——因此更换这两个品牌插件不会让侧边栏品牌行的其它内容位移；宽度则刻意不做约束，与 shell 已经把 mark 和 name 当作两个独立尺寸的 occupant 处理的方式一致（`SidebarRoot.module.css` 的 `.brand` 是 `flex: 1; min-width: 0`）。

## Alternatives considered

- **直接编辑 `ui-primitives` 里的 `BrandWordmark`，让它渲染 "PaperMachine"。** 拒绝：该组件是*官方* DeepSeek Harness 品牌资产，被 `ui-brand-official` 消费，并通过它被每一个非桌面 Host 消费。修改它会让一个仅限桌面端的决定，顺带改掉 Web 产品的品牌，而且之后也没有办法不再改一次就退回官方字标。
- **把字符串塞进 Runtime overlay 渲染出的 YAML（某一行的 `brandName` config 字段）。** 拒绝：侧边栏和 Hero 的品牌 slot 是渲染 React 组件的 UI slot（`SidebarBrandNameOwnerProps`、`HeroBrandMarkOwnerProps`），不是某个通用行会消费的文本 prop——不存在哪个 slot occupant 是"接收一个字符串、再排版出字标"的。一个 config 字符串仍然需要一个新的 UI 包去解释它，而那正是这个决定本就要构建的插件；直接做插件更直接，也让品牌呈现继续留在这个代码库对同一个替换点已经使用的 capability-seam 模式内。

## Consequences

桌面产品的侧边栏字标现在渲染为 "PaperMachine"，两个 mark slot 在 PaperMachine 专属美术出现之前仍由共享的鲸鱼图形填充，Web 产品的 `ui-brand-official` 组合逐字节保持不变（它自己的行、自己的构建 profile 守卫，与新包之间没有共享状态）。以后补上 PaperMachine 标记，只需在 `ui-brand-papermachine` 内部改一次 `Brand.tsx`；不涉及 bundle、overlay 或 slot 契约的任何改动。`ui-brand-papermachine` 这一行（禁用状态）会永久出现在每一个 Web/headless 组合里，这是共享 bundle 的一个无害既定事实——只要桌面端 overlay 不运行，它就是惰性的。两个品牌包现在也各自提供 `Context.clientBrand` 的 `productName`（`dsh-client-runtime`）——`ui-brand-official` 给 "DeepSeek Harness"，`ui-brand-papermachine` 给 "PaperMachine"——`ui-renderer` 的 `DocumentTitle` 改为读取它，而不是构建期的 `DSH_CLIENT_TITLE` 常量，因此桌面窗口标题与浏览器标签页现在与侧边栏字标同步切换。

## Verification

`packages/client/ui-brand-papermachine/tests/browser-plugin.client.spec.tsx` 覆盖了“注册先于/后于声明”两种顺序、fiber dispose 时的完整撤回（对照 `ui-brand-official` 自己的测试套件），以及字标渲染出的文本（`"PaperMachine"`，按两个 CSS module 字重 class 拆成 `"Paper"`/`"Machine"`）与两种 mark slot 尺寸。`packages/client/ui-brand-papermachine/tests/invariant.client.spec.ts` 覆盖了 invariant companion 与惰性的 node 半边 `apply()`。`apps/desktop/tests/runtime-overlay.spec.ts` 断言渲染出的 overlay 禁用 `ui-brand-official`、启用 `ui-brand-papermachine`，并且 overlay patch 的每一个 id（含两个品牌行）都存在于 base 的 `dsh-web-app` `cordis.patch.yml` 中。
