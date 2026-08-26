# Agent Note: 三个 Science 产品缺陷：preset 切换身份、不友好的 Runtime 错误，以及过期的重启信号

Status: implemented

[English](2026-08-18-science-mode-product-gaps.md) | 中文

## Problem

2026-08-18 的一次 hands-on 测试记录了三个 Science-mode 缺陷，均非本 note 一同落地的 artifacts/provenance 工作引入。

**tool-science 自身的 guard 读取的是冻结的创建时 header，而非 session 已解析的 preset。** `isScienceSession`（`packages/science/tool-science/src/context.ts`）直接检查 `session.header.agentPreset === 'science'`。header 是一个创建时事实，永远保持原样；一个在 blank 状态下被切换到 `science` preset 的 session——即产品的常规流程，对话 hero 里的 `AgentPresetSeat` 及其背后的 api-proxy `agentPreset.select` RPC——只会把这次切换记录为之后的一条 `agent-preset/selected` 事件，从不触碰 header。tool 可见性本身已经正确地跟随了这次切换（`dsh-tools` 的 scope layers 从存活的 `dsh-agent-presets` mount 解析，而非从 header 解析），因此一个已切换的 session 会正常地公告 `run_python`/`run_r`；而每次调用都会以 "this tool requires a session bound to the science preset" 被拒绝——这正是最初被归因为"非 Science session 中公告了 tool"的那个症状。每一个其他的 host 层 session preset 读取方（`dsh-host-apiproxy`、`resolveSessionPreset` 本身）都已经采用这种解析方式；tool-science 自己的检查是唯一的例外。

一个直接在 `science` preset 下创建的 session（创建时即 `agentPreset: 'science'`，CLI/ACP/headless 入口路径）永远不会遇到这个缺口——它的 header 从一开始就已经是 `science`。`apps/cli/tests/web-agent-presets.e2e.ts` 中的 `keeps its narrow roster out of standard, and standard's roster out of it` 已经证明，对这条路径而言，最初"每个 session 都公告 tool"的字面说法不成立：`run_python`/`run_r` 在 `standard` session 的 tool 列表中确实缺席，由 R4 preset-mount 架构正确 scope。

**Science Runtime 的未配置-profile 错误点名的是内部术语，而非修复方式。** `ScienceRuntime.profile()`（`packages/science/science-runtime/src/index.ts`）在遇到不在其已配置 map 中的 profile id 时，以 `unknown Science environment profile "science"` 拒绝——准确，但对一个人可以采取的行动只字未提：尚未为它命名任何 Conda 前缀，以及应在何处命名。所请求的 id 是固定的 preset policy（已发布 preset 自己的 `cordis.yml` 中的 `profileId: 'science'`），从不是 model 或用户输入，因此这个错误的每一次出现都只意味着一件事：该 deployment 尚未配置这个 profile。这条消息既会被直接阅读 Runtime 抛出文本的人看到，也会被把它转述给人的 model 看到，而它对两者都没有服务好。

**settings 卡片的 restart-required 信号是一个客户端本地标志位，而非一个 host 层事实。** `ScienceSettingsCardController` 用一个实例字段 `restartRequired` 追踪状态，在一次落地保存后被置为 `true`，此后再无其他清除路径。页面刷新会构造一个全新的 controller，因此无论运行中的 Host 是否真的重启过，该标志位都会重置为 `false`——一个保存了前缀、关闭标签页、在未重启 Host 的情况下重新打开它的人，看不到任何信号表明该变更仍处于 pending 状态，卡片也无法区分"Host 已经重启并读取了这次变更"与"自保存以来什么都没发生"。

## Decision

**`isScienceSession` 改为通过 `@deepseek-ai/dsh-agent-presets` 的 `resolveSessionPreset` 解析**（以 session 的创建 header 为基础，被最后一条 `agent-preset/selected` 事件覆盖），而不再直接读取 `session.header.agentPreset`。`tool-science` 为此获得了一个对 `dsh-agent-presets` 的 peer/dev 依赖——只是一个纯函数，不涉及 service 或 `ctx`（`dsh-agent-presets` 没有反向依赖到 `dsh-science`，因此不构成循环）。`requireScienceSession`（`run.ts`）与 `system-prompt/assemble` 首次使用绑定 waterfall 都调用 `isScienceSession`，因此二者现在都与 tool 可见性所用的 scope layer 在"哪些 session 运行在 `science` 之下"这一点上保持一致。

对于 header 与已解析 preset 在整个生命周期内始终一致的 session（在 `science` 下创建，或在其他 preset 下创建且从未切换），这一改动没有任何行为变化，直接补上了这一缺口。对于在 blank 状态下被切换到 `science` 的 session，`dsh-science-session` 自身的 durable-stream applicability 检查现在也与之一致了，并在同一改动中一并补上（见下一段与 Consequences）。

**`dsh-science-session` 的 durable-stream applicability 检查现在把 session 已解析的 preset 作为参数接收，而不再自行读取 `header.agentPreset`。** `assertScienceSessionApplicability`（`applicability.ts`）的签名从 `(header, state, event)` 改为 `(preset: string | undefined, state, event)`。其唯一调用方——`science-session-invariant` companion（`invariant.ts`）——沿着它已经在 `seed()`（Host 重启重放）与 `internal/dispatch`/`session/event` 这对 pre-commit 钩子（live 路径）中贯穿的既有 `ScienceFoldState` cursor，增量地追踪这个已解析的值——按 `resolveSessionPreset` 同样的规则（最新一次选择胜出）在每条 `agent-preset/selected` 事件后向前推进，而不是直接调用 `resolveSessionPreset` 本身。`dsh-science-session` 新增了对 `@deepseek-ai/dsh-agent-presets` 的 peer/dev 依赖，但只是为了让这次增量遍历能够针对 `agent-preset/selected` 这个 `SessionEventMap` 类型扩展做类型窄化——不涉及任何运行时调用，因此这并非下文所考虑的那个 alternative 所担心的分层倒置。

**`ScienceRuntime.profile()` 改为以新的 `PROFILE_NOT_CONFIGURED` code 拒绝**，其消息会点名缺失的前缀以及 Settings → Plugins → Science 卡片，取代了此前把"你什么都没配置"与"你发送了无效内容"混为一谈的 `INVALID_REQUEST` code——既然二者现在需要不同的消息，这个区分值得保留。这个检查是 `bindEnvironment` 与 `startRun` 解析 profile id 所共用的唯一关口，因此消息的改进只需一处编辑即可覆盖每个调用点，符合"在做出决定的那个操作中执行决定"。

**`SettingsProvider`（`dsh-settings`）为 `restart`-applies 的 namespace 捕获其 owner 在注册时实际读到的值**（`SettingsRegistration.effective`，在进程生命周期内冻结不变），与始终最新的 `resolved` 值并存，并在 `describe()` 中把二者都暴露出来：`value`（当前文档）与 `effective`（运行中 owner 实际据以行动的值）——对 `live`-applies 的 namespace 二者相等，因为它在每次 commit 后都会重新读取。这是对 settings seam 的一次通用添加，而非 Science 专属的：任何 `restart`-applies namespace 的配置界面，现在都能仅凭协议本身区分"已保存"与"已生效"。该字段沿着 `applies` 已经沿用的同一条路径，贯穿 `dsh-host-apiproxy` 的 `SettingsNamespaceView` 与 `dsh-client-runtime` 的 `SettingsScopeSnapshot<T>`。

`ScienceSettingsCardController` 用一个纯投影函数 `hostState()`（`'effective' | 'pendingRestart' | 'notConfigured'`）取代了原来的 `restartRequired` 实例字段，该函数对比 `snapshot.effective` 与 `snapshot.value` 中 `science` 键的存在状态——不再有任何簿记，不再有任何客户端本地状态，因此页面刷新后一个全新的 controller 会给出与存活 controller 相同的答案。`'pendingRestart'` 同时覆盖两个方向：一个刚保存、Host 尚未读取的值，以及一个刚移除、Host 仍绑定着的值。卡片把 `'pendingRestart'`/`'notConfigured'` 渲染为既有的 `role="status"` 提示行（复用既有的 `restartRequired`/`unconfiguredHint` locale key，措辞上明确点出"已保存"）；`'effective'` 则渲染一条新增的、纯文本（非 `status`）确认行——这是一个静态事实，而非需要 assistive technology 播报的瞬时更新，与字段自身的 hint 渲染方式一致。

## Alternatives considered

**只修复 `isScienceSession`，并宣布缺陷一已收尾。** 已否决，因为不完整：blank 状态下的切换场景仍会失败——tool 可见性正确，但执行仍会被拒绝——只是换成了从 `dsh-science-session` 自身 applicability guard 冒出的一个更深层、不同的错误，而非 tool-science 的消息。记录下这个残留缺口（见 Consequences）比一个只部分收尾症状的修复更诚实。

**直接在 invariant 的 pre-commit 调用点调用 `resolveSessionPreset(session)`，而不是增量地追踪已解析的 preset。** 这只在 live dispatch 路径下才正确——那里 `session.events` 已经反映了此前每一条已提交的事件。但 `science-session-invariant` 还会在 Host 重启时把一个 session 的完整历史从头重放一遍（`seed()`），对每一条历史事件重放一次 `assertScienceSessionApplicability`；如果在那里调用 `resolveSessionPreset(session)`，会把每一条历史事件都按 session 当前（整份日志的）preset 来解析，错误地把之后才发生的 `science` 切换追溯性地套用到切换之前、原本运行在 `standard` 下的历史事件上。`packages/science/science-session/tests/invariant.spec.ts` 的重新 seed 测试正是为了捕获这个回归而存在。增量 cursor（在 `agent-preset/selected` 事件后前进，采用与既有 `ScienceFoldState` cursor 相同的携带方式）对 seed 路径与 live 路径都能给出正确的、按时间点解析的答案，不会出现这种失效模式。

**为 settings 卡片单独开一个 Science 专属 RPC，用来回答"运行中 Host 已绑定的 profile"。** 已否决，选择了通用的 `dsh-settings` seam 添加方案：`applies: 'restart'` 早已作为一种逐 namespace 的声明存在，却始终没有办法回答"重启后会生效成什么样"，而任何其他 `restart`-applies 的 namespace 都存在完全相同的缺口。一个专属 Remote（`pluginInventory` 的模式）本只会解决这个 seam 本就缺失的一个字段所造成问题中，属于 Science 的那一个实例。

**始终展示一条明确的"configured, effective"状态横幅。** 已否决：卡片自己既有的测试套件早已确立"没有什么需要关注时零条状态行"作为其惯例（`shows a neutral "Configured" badge...` 断言了 `queryAllByRole('status')).toHaveLength(0)`），保留这一惯例可以避免为一个刚刚并未发生变化的事实触发屏幕阅读器播报。这条确认信息仍会渲染，作为与字段 hint 并列的纯文本，在不违背既有惯例的前提下满足了"卡片展示……configured, effective"。

**把新增的 `dsh-settings`/wire 字段改个名字，以避开本仓库其他 prose 中早已存在的"effective value"非正式用法（schema defaults → base → user 的解析结果）。** 在字段已经贯穿六个文件之后才被考虑到；这两种含义可以凭上下文区分（一个是 prose 中使用的文档解析术语，另一个是一个具名的 struct 字段），一处特别容易引发混淆的注释已被改写措辞（`provider-form.client.spec.tsx`），而非重命名已发布的字段。

## Consequences

缺陷一与缺陷二作为经过 real-composition 与单元测试验证的、范围受限、风险较低的修复发布；缺陷三则作为对 settings seam 的一次小型、真正通用的添加，以及 Science 卡片对它的消费而发布。

**blank 状态下的 preset 切换场景，其 Science session 现在得到了完整支持，而不再只是部分。** `isScienceSession` 与 `dsh-science-session` 自身的 durable applicability 检查现在一致了：二者都解析 session 的 live preset（创建 header，被最后一条 `agent-preset/selected` 事件覆盖），因此首次使用绑定——从 `science/mode-bound` 到之后整个 Science turn——对一个在 blank 状态下切换到 `science` 的 session 能够成功，不再有"tool 可见、执行仍被拒绝"的残留缺口，也不再有需要单独记录的更深层失败形态。`apps/cli/tests/web-agent-presets.e2e.ts` 中的 `fails loudly before any provider request when the mounted Science Runtime has no profile configured` 测试现在断言的是 `PROFILE_NOT_CONFIGURED` 的消息文本，取代了此前对 `INVALID_REQUEST` 时代"unknown Science environment profile"措辞的占位断言。

**`ScienceRuntimeErrorCode` 新增了一个成员**（`PROFILE_NOT_CONFIGURED`）；本仓库中目前没有任何代码 switch 这个 closed union（`.code` 仅作为测试/诊断元数据被读取），因此这次新增不会带来任何穷尽性 switch 上的连锁影响。

**`SettingsDescriptor`/`SettingsNamespaceView`/`SettingsScopeSnapshot<T>` 新增了一个必填的 `effective` 字段。** 本仓库测试与 fixture 中对这三种形状的每一处字面量构造都需要多写一个字段（一次机械的、由编译器驱动的批量修改——除了类型使之可见的部分之外，这些调用点没有任何运行时行为变化）。未来任何消费 settings 的卡片，都能免费从 Science 现在使用的这同一条 wire 路径获得 `effective`。

## Testing

`packages/science/tool-science/tests/tool-science.spec.ts` 新增了一个在 `standard` 下创建、随后通过 `agent-preset/selected` 事件切换的 session，断言 `isScienceSession`/`requireScienceSession` 从日志中正确解析为 `true`——这正是仅凭 header 的检查会答错的场景。`apps/cli/tests/web-agent-presets.e2e.ts` 中既有的 `keeps its narrow roster out of standard, and standard's roster out of it` 仍然是证明"非 Science session 中被公告"这一最初说法在当前架构下不成立的 real-composition 证据。

`packages/science/science-session/tests/applicability.spec.ts` 把每个用例都改为传入一个已解析的 preset 字符串（或 `undefined`），而不是一个 header 对象。`packages/science/science-session/tests/invariant.spec.ts` 新增两个测试：一个 live-dispatch 用例（一个在 `standard` 下创建的 session，`science/mode-bound` 在 `agent-preset/selected` 切换前被拒绝、切换后立即被接受），以及一个 seed/replay 用例（一个已切换 session 的完整历史，在模拟的 Host 重启后从头重新 seed，不会被回溯性地判定失败）。

`packages/science/science-runtime/tests/{environment,settings,loader-composition}.spec.ts` 把未知/未配置 profile 的断言从 `INVALID_REQUEST` 更新为 `PROFILE_NOT_CONFIGURED`，其中一处还断言了完整的新消息文本。

`packages/settings/settings/tests/settings.spec.ts` 新增三个测试：`effective` 在一个 `restart`-applies namespace 的注册时被冻结、且在之后的写入中保持不变；`effective` 对一个 `live`-applies namespace 随每次写入更新；以及 `effective` 一旦与 `value` 出现分歧后被独立脱敏。`packages/client/ui-settings/tests/settings-scope.client.spec.ts` 新增了从 wire 到 snapshot 的贯穿用例。`packages/client/ui-science/tests/settings-card-controller.client.spec.ts` 新增了一个专门的 `hostState` describe block（覆盖全部三种状态、两个不一致方向），并更新了每一处既有的基于 `restartRequired` 的断言；`packages/client/ui-science/tests/ScienceSettingsCard.client.spec.tsx` 更新了对应的渲染文本断言，并新增了纯文本（非 `status`）的 `'effective'` 确认用例。

## Related

[R6 settings/Details Agent Note](../feature/2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 记录了 settings 卡片最初的 `restartRequired` 机制，现已被 `hostState` 取代；其事实性描述已在本次改动中一并更新。[R3 Science tools Agent Note](../feature/2026-08-16-dsh-science-v01-r3-science-tools.zh.md) 记录了本 note 所取代的、仅凭 header 判断的 `isScienceSession` 检查；其事实性描述已按同样方式更新。
