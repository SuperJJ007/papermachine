# Agent Note: DSH Science v0.1 R6 设置与 Details

Status: implemented

[English](2026-08-17-dsh-science-v01-r6-settings-details.md) | 中文

## Problem

在 R6 之前，Science 路线已经验收 Session、Runtime、模型工具、preset 与持久 chart/Outcome 层。已交付 Web 应用没有面向用户的路径来配置 `science` Runtime profile、查看该 profile 是否已配置，或在单个 tool occurrence 之外检查当前 Science Session。用户选择 Science preset 后可能只得到首次使用 Runtime diagnostic，却没有设置路径；完成分析后也没有当前状态侧栏。

R6 只关闭 `SCI-SETTINGS-SIDEBAR` inventory 行。它保留 Runtime 对既有 Conda prefix 的归属，阻止绝对 Host 路径进入模型与浏览器可读状态，复用持久 `science` Session projection，并扩展现有 settings 与 Details 插件点，而不是替换其 shell。R6 不重开已验收的 R5 决定，也不把设置扩展成 Conda 发现、包安装、环境变更、Desktop 或发布工作。

## Decision

R6 以五个检查点交付：Runtime settings 归属（R6a）、通用 Details 路由（R6b）、路径寻址的 settings 写入原语（R6c-0）、settings scope secret-presence 读取（R6c-0b），以及 Science settings/Details 产品表层（R6c）。Web bundle 挂载一个刻意未配置的 Science Runtime，在现有 Plugins settings section 中为已交付的 `science` profile 提供 Science settings 卡片，并在现有右侧 Details column 中增加 Science entry。Headless 与自定义 deployment 继续显式提供 Runtime composition。

R6 改变设置路径，不改变执行权威。用户通过 settings 卡片为固定 `science` profile 填写既有 Python 与 R Conda 的绝对 prefix，然后重启 Host。Runtime 继续按 R2 规则观察、约束并执行这些 prefix；它不发现、创建、clone、求解、安装、更新、修复或删除环境。Science Details entry 保持只读，从已验收且对 Client 安全的 Session projection 派生 mode、environment summary、runs、charts 与最新 Outcome。

R6a 与 R6b 落地于已验收的 R5 收口 head 之上，早于本开发线合并上游 rc.7。上游 `4366528a38`（[由插件自己拥有的设置表层](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md)决定）删除了 `api-proxy` 的 settings 暴露白名单，并让 `settings.plugin.item` 成为以命名空间为键的 slot，因此注册一个 namespace 现在默认即被服务。若把 R6c 的卡片落地在 rc.7 之前的白名单架构上，要么在 Science 开发线内 fork 该白名单，要么请求某个共享包的所有者在上游已构建通用机制之前先为 Science 单独承载一条清单项；[rc.7 基线迁移](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)先合并了上游 rc.7，使 R6c 瞄准的正是交付之后仍然current的那套机制。R6a 与 R6b 在这次合并中改变了树身份——`installSettingsSection` 与 `settings.plugin.item` 注册路径在 rc.5 时就已存在，rc.7 也未触碰两者——因此它们经评审的身份是迁移之后的 head，而不是迁移之前的提交。

### Exact identities and dependency order

| Subject | Identity or rule | R6 use |
|---|---|---|
| 已验收产品基线 | [R5 closure](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md) head `16f5ce76abf8483c42bf02214cf15d82a2300b9c` | R6a 与 R6b 在基线迁移之前所依据的基线 |
| 基线迁移之后的基线 | [rc.7 基线迁移](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md) head `24971d5f14c8b9dc692658a0bb1cab599a4ed526` | R6c-0、R6c-0b 与 R6c 的唯一实施基线；R6a 与 R6b 迁移前的 SHA 属于历史，不是起步条件 |
| R6 inventory 行 | [`SCI-SETTINGS-SIDEBAR`](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | 唯一产品 delta，由本 Note 关闭 |
| Runtime authority | [R2 Science Runtime](../../implemented/feature/2026-08-15-dsh-science-v01-r2-science-runtime.md) | 既有 prefix 观察、执行、约束、lease 与真实 Python/R 验收继续由其归属 |
| 已交付 composition | [R4 Science preset](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) 加 [R5 charts and Outcome](../../implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md) | 保留固定 `science` preset identity；R6 增加下述 Host/Client rows |
| Source base | [由插件自己拥有的设置表层](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md)，上游 `4366528a38` | 注册一个 settings namespace 即意味着把它服务出去；`settings.plugin.item` 是以命名空间为键的 slot。R6c 的卡片瞄准这个机制，而不是 ApiProxy 白名单条目 |
| R6c-0 | `76012736a1`——`SettingsScope`/`SettingsScopeController` 上路径寻址的 `setPath`/`unsetPath` | 卡片两段式字段写入所用的通用写入原语；未改动任何 Science 自有文件 |
| R6c-0b | `6a994ef4cb`——`SettingsScopeSnapshot.secrets` | 卡片 configured 状态检测所用的通用读取原语；未改动任何 Science 自有文件 |
| Final head | `e125ce00327e4ffce9cc01f371b9068fd142dfcc` | 本 Note 绑定的 head；[dated R6 evidence](../../../../docs/evidence/2026-08-18-dsh-science-v01-r6-settings-details.md) 记录完整提交链与每条命令结果 |

### Runtime settings ownership

`@deepseek-ai/dsh-science-runtime/with-settings` 以同一份 `Config` 提供与根入口相同的 service，并额外把现有 `profiles` 配置作为 `science-runtime` 用户设置 namespace 的 composition `base`。该 namespace 只包含 profile map；`dshHome`、执行 timeout 与 artifact diagnostic bounds 继续由 Cordis 配置，因为 R6 没有编辑它们的产品需求。根入口保持原有行为，永不读取 settings。

settings capability 是 `with-settings` 入口声明的 Cordis injection，而不是 Runtime 在 load 时去探测的东西：`attachRuntimeSettings`（`packages/science/science-runtime/src/settings.ts`）只在被注入的 settings provider 处于 ACTIVE 状态后才运行，因此挂载该入口却没有 settings provider 的 deployment 会因未满足的 injection 停在 PENDING，而不是静默地只用 Cordis map 解析 profiles。

设置 schema 把空 profile map 视为刻意未配置状态。每个已声明 profile 仍使用 R2 safe-id grammar，至少包含 `pythonPrefix` 或 `rPrefix` 之一，并使用绝对路径；无效的已声明 profile 会让注册或设置写入失败，`parseProfiles`——与 Cordis `configSchema` 相同的校验器——支撑着 settings 的 `validate` hook。请求的 profile 缺失时仍在 provider I/O 与任何 Science event append 之前失败；不会回退到其他 profile 或发现的路径。

`with-settings` 入口使用 `applies: 'restart'` 注册 namespace，在 plugin load 时只捕获一次 resolved profile map，并且不 watch 它。Cordis entry configuration 继续作为低优先级 deployment base；用户 settings 文档可以通过现有 settings revision 与 mutation 规则覆盖或移除字段。成功写入只改变下一次 Host 启动；不能在 live Session 下替换环境。

`pythonPrefix` 与 `rPrefix` 在 namespace schema（`scienceRuntimeProfilesSchema`）上是 `role('secret')` 字段，因此在每个面向浏览器的 settings descriptor 上都是 write-only：没有任何 settings response、forwarded event、diagnostic、snapshot 或 projection 携带路径值，Host logs 与模型可见文字同样不含路径。

已交付 Web bundle 与 base settings、subprocess、sandbox、attachment 与 Science Session services 一同挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，配置为 `profiles: {}`；排在 settings provider 之后的是 Cordis，而不是 entry order。在设置并重启完成前，这会把默认 Web failure 从"Runtime service missing"改成更可执行的"science profile missing"。CLI/headless bundles 不增加该 row；其 deployment overlay 继续拥有权威。

### Generic Details routing

`@deepseek-ai/dsh-client-ui-conversation` 携带名为 `conversation.details.view` 的 list slot。现有 tool-call body 是内置 `tool` entry，保留其 input/output rendering 与 `conversation.details.tool` child seat。Details shell 拥有 column geometry、close behavior、title chrome、collapsed 时保持 mounted 的 lifecycle 与 fallback behavior。

per-Session conversation store 携带 `detailsView` id 及其选择 action。激活 tool row 时先选择 `tool` 与对应 call，再打开 column。session-header action owner 获得 `openDetailsView(id)` callback，用于选择已注册 entry 并打开同一 column。缺失、已移除或陈旧 id 回退到 `tool`；切换 Session 时继续沿用现有 AppFrame 行为关闭 column。

Details shell 从 slot registry 派生 labels 与 ordered entries，订阅 registry/locale changes，并且只渲染所选 entry。Registrations 均为 effects；卸载 domain entry 会移除其 label 与 body，并保留内置 tool entry 可用。任何 domain package 都不占用顶层 `details` slot，也不导入 Details shell implementation。

Title 文本是 shell 自行解析、而非纯粹读取 registry 的唯一例外：内置 `tool` entry 活跃时，shell 计算所选 call 自身的名称（回退到 selection 携带的 tool name，再回退到通用 label），因为 per-session store 的 selection 无法表达 registration-time label；其余每个 entry 的 title 都是其注册的 label。

### 路径寻址的 settings 写入（R6c-0）与 secret-slot presence（R6c-0b）

R6c-0 之前，`SettingsScopeController` 的 `set`/`unset`（`packages/client/ui-settings/src/client/settings-scope.ts`）只写入单段路径，而 Science 卡片要编辑的字段却深两段。R6c-0 为浏览器侧的 `SettingsScope<T>` 契约及其 controller 增加了作为 PRIMITIVE 的 `setPath(path, value)`/`unsetPath(path)`：`set`/`unset` 保留其原有单段行为，现改由 `setPath([field], value)`/`unsetPath([field])` 实现，因此写入队列、revision fencing 与 stale/rejected-write 恢复都只存在于一处。wire 层的操作（`SettingsPathOpView` 本就携带任意深度的 `path: string[]`）与 Host settings seam 都不需要改动。这是一处未触碰任何 Science 自有文件的通用 `ui-settings` 改动，作为其自己已验收的 head 落地并评审，早于任何 Science 文件改动。

在 R6c-0b 之前，`role('secret')` 字段在每次 wire read 中都会从 `SettingsNamespaceView.value`/`.base`/`.user` 中被剥离，因此浏览器卡片编辑一个 write-only 字段时，无法从 `SettingsScopeSnapshot` 得知 Host 是否为它持有一个值——而这正是 Science 卡片 "configured" 状态所需要的。wire 层本就在 `SettingsNamespaceView.secrets` 中单独回答了这个问题（从 section root 起算的路径，加上是否已设置一个值），`SettingsScopeController.accept()` 本就收到过这份列表却将其丢弃。R6c-0b 增加了 `SettingsSecretPresence`（`packages/client/runtime/src/client/contract/settings-scope.ts`，一个不导入 wire 类型的最小结构类型）以及 `SettingsScopeSnapshot<T>` 上的 `secrets: readonly SettingsSecretPresence[]` 字段，由 controller 在每个已接受的 view 上与 `base`/`user` 一同填充，并在 namespace 不可用时保持不变，与这两个字段既有的处理方式一致。这弥补了 R6c-0 的写入原语打开的读侧缺口，且没有增加第二个 `settings.describe` 状态权威：Science 卡片早先工作树中的机制直接调用 `api.settings.describe({})`，把 `dsh-client-connection` 与 `dsh-client-web-react` 拉进了 `ui-science`（这是其余任何读取都不需要的两个 Client package），使每次 scope 变化的 describe 流量翻倍，并从一次绕过了已绑定 scope 自身写入队列与 revision fencing 的读取中计算保存结果。R6c-0b 在 Science 卡片交付之前替换掉了这一机制，因此已交付卡片只从 `scope.getSnapshot().secrets` 读取 presence。

### Science settings and Details product surface

`@deepseek-ai/dsh-client-ui-science` 是 Science settings 卡片、Science header action 与 Science Details entry 的 owner，与其 R5 的 `save_chart`/`publish_outcome` toolview rows 并存。它注册一张**以键区分**的 `settings.plugin.item` 卡片，键为 R6a 所注册的 namespace `science-runtime`——而不是某个 package 或产品 id——一个 `conversation.session.header.actions` entry，以及一个 id 为 `science` 的 `conversation.details.view` entry。以命名空间为键意味着该卡片不需要 `settings.section` 页面、不需要导航行，也不需要改动 Host 即可出现：已交付 Web bundle 同时挂载 `ui-science` 与 `ui-settings-plugins`，Plugins 分区的 `configurable` 标签页为 Host 服务的每个 namespace 派发一个 slot 键，而没有挂载 `with-settings` Runtime 入口的 deployment 看不到该卡片的任何痕迹，与该分区既有的空态行为一致。

该卡片通过 `ctx.settingsScope.bind({ namespace: 'science-runtime' })` 绑定 `science-runtime` namespace，只写入 `setPath(['science', 'pythonPrefix'], …)`、`setPath(['science', 'rPrefix'], …)` 与 `unsetPath(['science'])`——绝不写 section root。写入路径的深度由 `attachRuntimeSettings` 决定，它以 `base: config.profiles` 注册该 namespace：section root **就是** profile map 本身，而不是一个 `profiles` 包裹字段，因此 `['science', 'pythonPrefix']` 才是正确坐标，`['profiles', 'science', 'pythonPrefix']` 不是。`redactSecrets` 从同一个 section root 开始遍历（`packages/settings/settings/src/redact.ts`），因此卡片、wire 与 Host 三方一致认同的 secret path 都是这个两段形状；一次真实 Host 运行确认了这一点，把 `science-runtime:\n  science:\n    pythonPrefix: …\n    rPrefix: …` 写入了 settings 文档。没有任何代码路径写入 section root 本身：那样做会用浏览器暂存的这一个 profile 替换掉某个 deployment 声明的每一个 profile，悄悄抹掉被脱敏客户端视图从未见过的那些 profile。

卡片展示 loading、显式只读状态、unconfigured、configured、saving、Host 拒绝的写入、client 端拦截的无效草稿、saved-restart-required 以及 reset-to-composition。Host 拒绝的写入（stale revision 或 Host validation failure）在 controller 中是一个不可区分的 `failed` 状态，因为两者都通过 scope 自身的读回以相同方式恢复；此前方案中分别列出的 "stale-revision" 与 "validation-failure" 两个状态收敛为这一个已交付状态。空 replacement inputs 是 no-op；显式 remove-override action 会 unset `['science']`，在没有 composition base 时回到 unconfigured，否则重新显现该 base。其他 deployment profile ids 继续由文件/配置负责，R6 不把它们变成通用 profile manager。共享卡片模型中的 "namespace 缺失" 情形对本卡片不可达，因此未被做成 UI：Plugins 标签页只为 Host 真正提供的每个 namespace 派发一个 slot key，所以卡片只在其 namespace 被提供时才会被挂载，namespace 缺失这一情形在 tab 层渲染为空。

bundle-purity gate 禁止 Science 卡片以值导入方式引用 `ui-settings-plugins` 的卡片 chrome（`PluginCard`）或其 staged-form model，因此该卡片自行拥有 chrome，也自行拥有 staging/revision fencing。该 chrome 建立在 `@deepseek-ai/dsh-client-ui-primitives` 之上——`Input` 用于两个 prefix 字段，`Pill` 用于 Configured/Not configured 徽章，`Button`（`primary`/`outline`/`ghost` 变体）用于 Save/Discard/Remove override——外加一个手写的、默认折叠的 disclosure header，带 `aria-expanded` 与 "展开设置/收起设置: <name>" 这一寄存器风格的可访问名称。`DisclosureRow`（`@deepseek-ai/dsh-client-ui-primitives`）刻意不是该 header 的基础组件：它是 transcript/tool row 所用的紧凑 24px icon-leading chrome（`ReasoningRow`、`ToolRow`），不供任何 settings 卡片使用，也不提供两行式 name-over-description 的 header 形状；`PluginCard` 本身手写了与本卡片相同的 header-button 模式，原因同上。折叠时，可访问性树中只有 header——每个字段、hint 与操作按钮只在展开后才渲染，与每个同级卡片一致，也消除了该卡片早先始终展开的渲染方式与 Terminal 卡片同名按钮之间的可访问名称冲突。

浏览器永不回显已存 prefix。已配置字段显示中性的 "configured" 状态；替换时必须提供新的绝对路径，空字段不产生更改，显式 reset 只移除 user-layer `science` profile，使 composition base 能重新显现。Settings conflict 会先重新读取当前 descriptor，之后才允许再次写入。R6 不增加 browser filesystem picker、path discovery、prefix probing、package inventory 或 live apply button。

仅当当前 Session summary 指向内置 `science` preset 时，Science header action 才出现。激活它会打开 `science` Details entry。该 entry 读取 `science` Session projection，展示对 Client 安全的 environment summary、排序后的 run status/history、logical charts 及其最新验收版本，以及带 evidence references 的最新 Outcome。Chart thumbnails 经由该 entry 自己的 `science-attachment-loader.ts` 解析，而不是 transcript rows 所用的、conversation-owned 的 session attachment loader，因为 `conversation.details.view` 的 owner share（`DetailsViewOwnerProps`）不携带任何内容，`IConversation` 的对外接口也不暴露 `resolveImage`——具体的图像解析 service 留在 `ui-conversation` 内部。该 loader 转而直接调用 `ISession.readAttachment`，这是文档记录的 session "behavior verbs" 之一，功能包可以直接调用，并把返回的字节转换为一个 stateless 的 `data:` URI：没有 `Map`，没有 `URL.createObjectURL` handle，session release 时无需撤销任何东西，也不构成第二个 attachment cache——这与 `packages/client/ui-science/README.md` 记录的 "No independent attachment cache" 限制一致。

在首个 Science event 之前，Details entry 展示已选择 preset 与 unbound 状态。缺失 projection support、attachment unavailable、Runtime binding failed、无 runs、无 charts 与无 Outcome 各有不同的可访问文字；environment 分区绝不仅凭配置就报告 capability，因为任何 `status` 不是 `'applied'` 的 revision 都渲染相同的 binding-failed 文字。Standard 与自定义非 Science Sessions 不获得 Science header action，也不会自动打开 panel。UI 不把已配置 prefix 当成已验证；interpreter capability 只能来自 Host 重启并实际使用后形成的持久 environment binding。

### Runtime row-id ownership

已交付 Web bundle 拥有 `science-runtime` 这个 Cordis entry id：`ScienceRuntime` 与其 `with-settings` 替代版本提供同一个单一 provider 的 `ctx.scienceRuntime` service，因此通过 Cordis configuration 提供自己 profile map 的 deployment 会按 id 覆盖那一行——一次改动 `config` 而非切换所挂载插件的同 id patch——而不是插入第二个 Runtime row，插入会在 load 时抛出 `service "scienceRuntime" has been registered`。一个 patch row 不能把某个已存在的行改名为同一 id 下的另一个插件：Loader 的 `applyEntryPatches` 在应用 overrides 之前会把 `name` 从 patch 的 overrides 中剥离出来，而当 patch 自身的 `name` 字段与目标 entry 当前的 name 不一致时，它会跳过整个 patch 并给出 name-mismatch 警告，而不是部分应用它。切换某个 id 上所挂载的插件——例如从 settings-bound 入口换回纯粹的 `@deepseek-ai/dsh-science-runtime` 入口——因此不是一次同 id 覆盖；而是按 id 禁用既有行，再在另一个 id 下插入一个新 entry，这与本仓库其他任何一次插件替换所用的 disable-and-insert 机制相同。

### Documentation and evidence

实施更新了 Runtime、`ui-conversation`、`ui-science`、settings、Science subsystem、package group 与 Web composition owners；它们的中文 pairs；受影响的 generated package/config/capability/module references；以及 browser snapshot expectations。仍然 active 的 R2、R4 与已验收 R5 Agent Notes 只在 R6 改变其当前事实的位置被更新，不把 R6 rationale 复制进去。

易变 SHA、commands、platform versions、真实 prefix identities、browser channels 与 pass/fail results 只存在于 dated [R6 evidence triplet](../../../../docs/evidence/2026-08-18-dsh-science-v01-r6-settings-details.md) 中。Source checks、built/packed Web evidence、真实 Python/R acceptance、Desktop、signing、notarization、publication 与 release 在那里分别列出；R6 source 或 packed-Web success 不会提升未运行的层。

### Verification and closure

R6c 按[基线迁移](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md)推迟的那项基线对照事项，在同一个检查点内分为一趟源码 pass 与一趟单独出证的有人值守 pass 执行。源码 pass 落地了全部产品改动，配以聚焦、装配级 keyless、无障碍与 snapshot 覆盖，外加 `typecheck`、`lint`、`build`、`hygiene`、`doc-sync` 与空白检查。有人值守 pass 随后记录了需要无人干扰桌面的部分：一份真实 server 的 GIF、真实 Python/R Runtime acceptance、packed Web verification，以及被推迟的基线对照归因。dated evidence 把每一项结果都绑定到上文所记的准确 head。

### Supersession and lifecycle

R6 修订了 R2 的 configuration facts，加入 restart-only user-settings layer 与刻意 empty Web state；修订了 R4/R5 的 composition facts，加入 default Web Runtime 与 Science Details consumers；并让它们的 execution、preset、chart、Outcome 与 privacy rationale 继续 active。本次改动不 archive 任何 implemented note，不 supersede 任何 proposal，也不删除任何 rejected guardrail。

## Alternatives considered

**把 Runtime setup 留在 Cordis 文件，只增加只读 status page。** 否决，因为已交付 Web 应用仍会提供可选 Science preset，却没有产品设置路径。Settings seam 已支持 composition base、user override 与显式 restart timing，因此 R6 使用它，但不接管执行。

**由一个在 load 时检查 settings service 的 Runtime 入口绑定 namespace。** 否决，因为 Cordis Loader 并发创建兄弟 entries，该检查报告的是哪个 module 先完成 import，而不是 composition 声明了什么。只要 settings provider 的 module 落在后面，namespace 就不会注册，已存 profile 被静默忽略——而这正是用户为应用它而执行的那次重启——且 cordis.yml entry order 无法修复。声明式 injection 让 Cordis 为两者排序，并把缺失的 provider 变成可见的未满足依赖。

**Live 应用 prefix changes。** 否决，因为 live settings write 可能在 environment binding 与后续 run 之间改变 profile resolution，或要求迁移 exact-Session reservations 与 scratch ownership。Restart-only resolution 让每个 Host lifecycle 只使用一个 immutable Runtime configuration。

**发现或管理 Conda environments。** 否决，因为 discovery、create/clone/install/update/repair/delete、solver output、mutation locks、approval、rollback、quotas 与 cleanup 构成独立 capability。R6 只接受显式 existing prefixes。

**向浏览器返回已存 prefix paths。** 否决，因为 setup status 与 replacement 不需要披露绝对 Host 路径。Secret-path descriptors 保留 write 与 reset operations，同时阻止 browser snapshots 与 forwarded events 携带路径。

**给 Science 一个自己的 `settings.section` 页面，而不是一张 keyed 卡片。** 在 rc.7 基线迁移把 `settings.plugin.item` 变成以命名空间为键的 slot、并让 Host 提供每一个已注册命名空间之后，此选项被否决。一个独立页面会为两个 prefix 字段永久占据一行 Settings 导航，还要重新实现该标签页已经从"Host 提供了什么"推导出的可用性逻辑，并且会出现在从不挂载 Science Runtime 的 deployment 里。卡片则从拥有这些行为的分区获得派发、可用性与空态行为，而随附的 Web bundle 本来就挂载了两侧。若 Science settings 将来超出一个 profile 的两个字段，页面仍是正确的形态。

**让 settings 卡片轮询 `settings.describe` 获取逐字段 secret presence。** 否决，转而采用 R6c-0b 的 `SettingsScopeSnapshot.secrets` 字段。直接调用 `api.settings.describe({})` 把没有任何其他读取需要的两个 Client package 拉进了 `ui-science`，使每次 scope 变化的 describe 流量翻倍，并从一次绕过了已绑定 scope 自身写入队列与 revision fencing 的读取中计算保存结果——这是一个针对同一 namespace 的第二状态权威。扩展 scope 自身的 snapshot 让每个 namespace 只保留一个 settings-state 权威，并让卡片直接从同一次写入的结算结果推导出 "已落地"。

**让 `ui-science` 替换顶层 `details` slot。** 否决，因为这会移除 tool-call Details，并让一个 optional domain 拥有 generic column chrome。R6 在 conversation-owned routing slot 之后增加 domain entry。

**把 Science 渲染成另一个 center-column conversation tab。** 否决，因为 charts 与 Outcomes 已保留在 transcript 中，而 R6 需要一个可与 conversation 并列显示的紧凑 current-state surface。现有 Details column 提供这种关系，无需复制 transcript。

**把 R5 repair 并入 R6。** 否决，因为 R6 依赖已验收 R5 的持久 chart/Outcome 与 client-projection semantics。把 predecessor repair 混进 R6 会消除准确 accepted base，并使 R6 evidence 无法区分两个 inventory rows；在 R5 中发现的缺陷回到它自己的 candidate。

## Consequences

Empty Runtime row 让 service 在可用之前已经存在。settings 卡片点名缺失的 `science` profile，且首次模型调用仍在 provider I/O 之前失败；任何 UI 都不会在持久 binding 报告 capability 之前把 Runtime 标成 ready。Restart-only settings 可能让期待即时生效的用户意外，因此卡片在 save 后持续显示 restart-required state，也从不刷新 live Session 并宣称新 prefix 已 active。

Write-only path fields 减少披露，却让用户无法目视确认已存绝对路径；R6 优先保护 Host 隐私，转而提供 configured/user-override/reset state。注册一个 settings namespace 现在默认即被服务，适用于本开发线加入的每一个 namespace，不仅是 `science-runtime`：不再存在一道会把未标记字段以遗漏方式挡在浏览器之外的白名单兜底，因此未来任何 Science settings 字段都必须显式携带 `role('secret')`，而 redactor 自身对"只能通过 union、intersection 或 transform 抵达的 secret"这一遗留缺口（记录于[由插件自己拥有的设置表层 note](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md#consequences)）如今影响范围更广——覆盖任何已注册的 schema，而不仅是审计过的那些。

右侧 Details column 是一个共享的 routed surface；通用检查点独立于 Science 的 entry 保留了 tool fallback 与 HMR behavior，因此一次 optional domain unload 不会使普通 tool inspection 失效。已交付 Web bundle 拥有 `science-runtime` 这个 row id，若某个 deployment 想在该 id 下换用不同插件——而不只是为同一个 settings-bound 入口提供不同的 `profiles` 配置——就必须禁用该行并在新 id 下插入替代品；同 id 覆盖无法为该 entry 更换插件。

真实 Python/R acceptance 只证明已配置 interpreters 与 Runtime lifecycle，不证明 plotting-library availability、scientific correctness、Desktop packaging、installer behavior、signing、notarization 或 release readiness。GUI-change 规则对真实模型轮次 GIF 的要求，在 settings 卡片这一侧得到满足；session-header action 与 Details entry 则由一个真实浏览器 e2e 场景覆盖，而非真实模型轮次 GIF，因为能够产生真实模型轮次的 composer 位于一个 workspace-selection surface 之后，本轮既无法在无头模式下驱动一个不可驱动的原生对话框，又不愿为此改动被测入口。header action 与 Details entry 的这份 GIF 覆盖仍欠着，留给未来一轮；dated evidence 记录了确切缺口。
