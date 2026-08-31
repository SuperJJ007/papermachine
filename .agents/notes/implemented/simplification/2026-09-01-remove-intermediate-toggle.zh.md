# Agent Note: 移除中间稿展开切换

Status: implemented

[English](2026-09-01-remove-intermediate-toggle.md) | 中文

## 问题

Artifact 工具栏的版本步进器（`ScienceDetailsView.tsx`）带有一个「中间稿 ×*N*」切换按钮：点击后会临时把步进器的默认遍历顺序扩展为包含同轮中间稿——这些版本本被 `foldIntermediateVersions`（`intermediate-versions.ts`，C2）从默认遍历中折叠掉，因为同一 turn、同一产生 session 内的更晚版本已经取代了它们。产品负责人 2026-08-31 的明确拍板是：这个展开入口从来就不是用户想要的——用户在回顾成果时不需要看到模型同轮内的自检重渲染，而这个按钮暴露的恰恰就是折叠机制本要隐藏的东西。

## 决策

本决策删除了该切换按钮、守护它的组件本地状态 `showIntermediates` 及标签页切换时的重置 effect，以及它使用的两个 locale key（`toolbar.intermediateExpand`、`toolbar.intermediateCollapse`，中英文各一份）与随之成为孤儿的 CSS（`.intermediateToggle` 及其 `:hover`／`[aria-pressed="true"]` 规则）。`foldIntermediateVersions` 本身及其驱动的默认跳过行为保留：步进器的 `walkable` 列表现在无条件等于 `versions` 减去被折叠的集合，当前打开的版本始终豁免于自身的折叠（这一点未变——溯源下钻或直接链接仍可直接打开一个中间稿）。删除按钮不会让折叠成为死代码：折叠正是让中间稿默认不可见的机制，而一旦没有按钮能把它重新展开，这个默认状态就是全部意义所在。

## 曾考虑的替代方案

**把 `foldIntermediateVersions` 连同按钮一起删除。** 不予采用：折叠逻辑不是只服务于按钮的附属管道——它是让同轮中间稿默认不可见的唯一机制。删掉它会把每一次同轮自检重渲染重新交还给步进器的默认遍历，与产品负责人的诉求正好相反。

**保留按钮，但放到一个设置开关后面。** 不予采用：目前没有任何使用方要求一种展开中间稿的方式，一个没有可达 UI 的死设置开关正是包约定所拒绝的那种未使用的可配置性。

**保留 locale key 以备未来重新引入。** 不予采用：一个未被使用、也没有任何东西再翻译它的 locale key，在它最后一处引用被删除的那一刻就是死重量；未来若要重新引入，应在新入口对应的名字下新增 key。

## 后果

版本步进器现在只有一种行为、没有可配置性：除非某个同轮中间稿正是标签页当前打开的版本，否则一律默默跳过它。用户此后完全无法从工具栏发现或到达一个同轮中间稿——这份持久数据依旧只能经由溯源下钻或直接链接触达，这一点在本次移除前后没有变化。`ScienceDetailsView.client.spec.tsx` 保留了一条断言默认跳过行为的用例和一条断言「当前打开版本豁免」的用例；两条针对按钮本身的用例（渲染按钮、展开、收起）已删除。覆盖折叠算法本身的 `intermediate-versions.client.spec.ts` 未变。
