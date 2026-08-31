# Agent Note: 快照存储的再水合改为叠加在 `init()` 之上，而非整体替换

Status: proposed

[English](2026-08-31-client-store-rehydration.md) | 中文

## Problem

`packages/client/runtime/src/client/contract/store.ts` 中的 `attachPersistence()` 曾用 `api.setState(JSON.parse(raw), true)` 整体替换来再水合一个已持久化的存储——`init()` 被完全丢弃，对从 `localStorage`（一个 `AGENTS.md` 要求校验的持久化边界）读出的值不做任何校验。某个字段在存储键被铸造之后才加入状态,旧版本写下的任何载荷里都不存在它;读回时无论 `init()` 声明了什么,该字段都会变成 `undefined`。

两个正在上线的存储都踩中了这个问题。`ui-science` 的 `selection-store.ts` 持久化在 `dsh.science.selection.v1` 下;`libraryCollapsed` 与 `libraryTabs` 是在 `.v1` 后缀铸造之后才加入 `ScienceSelectionState` 的,而该后缀从未提升。一个既有载荷会以 `libraryCollapsed === undefined` 完成再水合;`ProjectLibrary` 的 `collapsed[sessionId] === true` 与 `rememberLibraryArtifact` 的 `draft.libraryTabs[...] = ...` 都会在读/写时抛出 `TypeError`——也就是被报告的"刷新后详情栏选中标记与折叠状态可能不一致"。`ui-conversation` 的 `stores.ts` 持久化 `dsh.conversation.chat`,完全没有版本后缀;`inspect` 字段是 2026-08-31(`6d13ded908`)才加入 `ChatStoreState` 的,面临同样的暴露。

另外,`ScienceSelectionState` 的 `lightboxOpen` 与 `view` 是瞬态 UI 状态:标签页关闭时仍处于打开状态的灯箱或溯源下钻,会在下次加载时重新盖在内容之上——这是 2026-08-30 记录在案的已知问题。持久化引擎里没有任何机制能把某个字段排除在存储之外,除非为每个存储手写 JSON 前/后处理。

## Proposal

再水合以 `init()` 的值为基准,只叠加持久化载荷中、基准本身已经拥有的顶层键:载荷里缺失的键保留其 init 值,载荷携带但基准未声明的键被丢弃而不是重新出现。这是一次浅层、单层的合并——嵌套结构漂移(某个字段自身内部结构发生变化)不在此次调和范围内,仍是版本后缀的职责,这一点写进了模块 JSDoc。载荷的顶层种类与基准不匹配时(基准是普通对象而载荷不是;或反之,原始类型/数组种类不一致)会被整体拒绝并保留 `init()`,走的是与存储或 JSON 解析失败相同的非致命 `console.error` 路径。

`defineStore` 的 `StoreSpec`(`packages/client/ui-slots/src/store.ts`,框架无关的契约)新增一个可选的 `transient?: readonly (keyof T)[]`:被排除在持久化两个方向之外的顶层字段——既不写入存储,读取时也忽略其存储值(包括早于该声明写下的历史载荷),始终从 `init()` 恢复。排除集合是存储 spec 上的声明,由 `keyof T` 对照状态自身的键做类型检查,而不是持久化辅助函数内部的隐藏规则。`selection-store.ts` 声明了 `transient: ['lightboxOpen', 'view']`;没有其他存储的 spec 被改动。`.v1` 持久化后缀没有提升——合并机制已经让这两个新增字段能正确再水合,提升后缀只会白白丢弃每个用户真实的已打开标签页。

绕过 `defineStore`、直接使用 `createSnapshotStore(init, { persist })` 的两处调用方——`sessions/service.ts` 的 `SessionSelection` 与 `ui-trajectory` 的 `duration-store.ts`——无需额外改动就获得了同样的合并:`attachPersistence` 在挂接时从 `api.getState()` 读取基准,而这个值此时已经等于传入的 `init`,因此无需再引入第二个 init 参数。`SessionSelection` 的两个字段原本是可选的(`sessionId?: SessionId`),作为 `init` 传入的 `{}` 字面量上不存在任何自身键,因此合并逻辑"基准已拥有的键"这一判定永远不会去恢复它们;现在这两个字段改为 `sessionId?: SessionId | undefined` / `subagentAddress?: SubagentAddress | undefined`,`init` 显式把两个键都赋为 `undefined`,从而给合并提供了真实可叠加的键,同时 `exactOptionalPropertyTypes` 仍然接受所有既有调用点(`{}`,以及条件展开的 `set()` 调用)不做任何改动。`duration-store.ts` 的标量 `boolean` 状态不需要这种改动:非普通对象的基准会整体接受同一原始类型/数组种类的载荷,这正是标量存储整体持久化原本的含义。

## Alternatives considered

**继续沿用版本后缀纪律,要求每次新增字段都提升后缀。** 这正是这次 bug 所暴露的现状:提升后缀是一个社会流程(需要有人记得去做),而非机械流程,并且它会在每次提升时丢弃每个用户真实的持久化状态——包括那些根本没变过的字段。合并机制让新增字段这类改动变得免费,把版本后缀真正限定在它本该承担的场景:某个字段自身内部结构发生了不兼容的变化。

**对嵌套对象做深度合并,而不是浅层顶层叠加。** 深度合并会让一个陈旧的嵌套载荷在更深一层悄悄复活旧的子结构(一个被重命名或重构的嵌套字段以旧名字重新出现),等于用一个更深层的"静默复活"bug 替换掉一个"静默丢失"bug,而且它仍然救不了一个真正不兼容的嵌套结构——那种情况依旧需要版本提升。浅层合并把这类 bug 限定在它本来发生的确切范围(顶层字段的增删),并明确声明了边界,而不是把边界推得更深。

**在存储边界引入运行时 schema 校验库(例如 zod)。** 目前每个存储被持久化的形状都只是"与 `init()` 相同的顶层键集合",不存在需要单独校验的字段类型、取值范围或嵌套不变量;引入 schema 库等于为一个如此浅的边界背上新增依赖的代价,却没有任何现成的字段级规则需要它来执行。`packages/AGENTS.md` 的"优先选用维护良好的依赖而非手搓"适用于已经存在自有校验逻辑与测试、库能够删除它们的场景——目前还不存在,因为整个校验就是"这个键是否存在于基准对象上"。

## Acceptance criteria

`packages/client/runtime` 中的单元测试覆盖合并逻辑(载荷缺失某字段时保留 init 值;载荷携带未知字段时被丢弃;非对象载荷——`null`、数组、字符串、数字——被丢弃并保留 `init()`;载荷缺席时保留 `init()`;标量状态遇到种类不匹配的载荷被丢弃)以及瞬态字段排除(写入的载荷省略了声明的字段;读取时忽略该字段的存储值,分别直接在 `createSnapshotStore` 层与通过 `defineStore` 声明验证)。一个 `ui-science` 测试预置一个缺少 `libraryCollapsed`/`libraryTabs` 的历史载荷,渲染 `ScienceDetailsView`,断言不会抛出异常、文件库分组以展开状态渲染、并且打开一个文件库产物仍会正确记录进 `libraryTabs`。`selection-store.client.spec.ts` 断言该存储 spec 声明了 `transient: ['lightboxOpen', 'view']`,且 `persist: 'dsh.science.selection.v1'` 未被提升。

## Risks

任何直接构建在 `createSnapshotStore` 之上(绕过 `defineStore`)、状态为对象且在其 `init` 字面量中把可选字段留空未赋值的存储——正是这次修复中的 `SessionSelection` 形态——都会在再水合时丢失这些字段,除非其 `init` 显式把它们赋值(哪怕是 `undefined`)使其成为基准自身的键;这对未来任何具有同样模式的低层调用方都是一个隐患,且未被机械强制检查。此次合并刻意保持浅层:某个嵌套字段的内部结构发生不兼容变化时仍需要版本后缀提升,本次改动不会检测这种情况——一个不兼容的嵌套载荷会照原样合并进去,并在下游失败,这正是版本后缀原本就存在的失败模式。
