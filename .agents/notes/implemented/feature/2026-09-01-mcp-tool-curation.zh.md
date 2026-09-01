# Agent Note: 部署级 MCP 工具筛选

Status: implemented

[English](2026-09-01-mcp-tool-curation.md) | 中文

## Problem

`@deepseek-ai/dsh-mcp-client`会注册已连接 MCP 服务器声明的每一个工具。桌面端部署接入两个论文检索 MCP 服务器，合计 76 个工具，把每一个工具连同其完整 schema 和描述都塞进每次模型请求——无论任务实际需要哪些工具，模型每一轮都要为 1–2 万 token 的工具选择噪声买单。`cordis.yml` 里没有任何手段能缩小这个集合、给部署认为命名令人困惑的工具改名、或替换一个未能触发正确工具选择的描述；唯一的手段是把整台服务器断开连接。

## Decision

**工具筛选是一个部署决定，在 `cordis.yml` 里一次性表达，绝非模型或按请求做出的选择。** `StdioConfig`/`StreamableHttpConfig`（`packages/mcp/mcp-client/src/index.ts`）新增可选的 `tools` 区块——`include`、`exclude`、`rename`、`describe`，均以服务器的原始 MCP 工具名（`rawName`）为键——由 `resolveToolFilter`（`packages/mcp/mcp-client/src/tools.ts`）一次性解析为 `Set`/`Map` 构成的 `ResolvedToolFilter`，由 `startConnection` 原样透传进 `ToolBridgeOptions`，在该插件实例的整个生命周期内保持不变。省略 `tools`——或者把每个字段都留空，这正是 Schemastery 把一个被省略的字段最终解析成的结果，因为 `object`/`array`/`dict` 三种 schema 类型在构造时就默认取 `{}`/`[]`，与是否显式调用 `.default()` 无关——会复现此前的既有行为：按服务器描述的原样，注册每一个已发现的工具。

**先 `include` 后 `exclude`，`rename` 只改变公开名后缀，`describe` 只改变已注册的描述。** `syncTools` 先应用 `include`（非空时限定为列出的 rawName），再应用 `exclude`（从剩余集合中剔除 rawName，与 `include` 是否缩小过集合无关）。`rename` 的值只在 `publicToolName(serverName, suffix)` 这一步推导中替换 `rawName`——规范化方式与任何其他工具名称使用同一套 DeepSeek 函数名称约定——而 `tools/call` 在协议上依旧发送原始 `rawName`；命名约定所记录的两个名称之间 `(serverName, rawName)` 的身份关系保持不变，`rename` 只是改变了在这一步推导中扮演 `rawName` 角色的那个字符串。`describe` 的值会替换 `createDefinition` 时读取的服务器提供描述。

**校验按"何时可解析"拆分，与 `resolveReconnectPolicy` 已经使用的"配置解析期 vs 连接期"拆分保持一致。** 两个不同的 rawName 改名到同一个后缀是配置本身的纯函数——在插件 `apply()` 内、任何 effect 注册之前，与既有的 reconnect 策略解析一起，在 `resolveToolFilter` 内部完成校验。`include`/`exclude`/`rename`/`describe` 中任何一处引用的 rawName 是否是服务器实际声明的,则需要一份存活的工具列表，因此 `validateToolFilterReferences` 运行在 `syncTools` 内部，每次同步都会执行——初始连接、每一次重连、每一次 `notifications/tools/list_changed` 重新同步——针对该次同步刚获取到的 rawName 集合校验，并把所有缺失引用合并进同一条消息，而非在第一个缺失处就失败。

**一个失效的筛选器引用，其失败方式与既有的"服务器两次列出同一 rawName"完全相同：`syncTools` 的获取阶段抛错。** `syncTools` 此前就会在服务器自身的工具列表与 harness 将要注册的内容不一致时抛错（一个重复的 rawName 解析到同一个公开名称）；一个引用了服务器从未声明过的 rawName 的筛选器引用，属于同一形状的问题——部署的工具桥接与服务器实际的工具列表出现分歧——因此复用同一条既有的获取阶段抛错路径，而非发明一种新的失败形态。这次抛错的既有消费方决定了它的实际效果：在初始连接时，`connectGeneration` 会把它当作一次连接尝试失败处理（按重连策略重试，或在 `failOnStartupError` 为 true 时拒绝插件激活）；在 `notifications/tools/list_changed` 之后的重新同步时，通知处理器记录 `tool re-sync failed` 日志并保持上一世代的注册不受影响，符合既有的"获取阶段失败保留上一世代"约定。没有引入任何新的失败处理机制；一次配置与服务器名称不匹配的问题，本就应该经由那套已经能识别"工具列表出错"的机制来暴露，让名称冲突和名称未找到这两类诊断留在 `syncTools` 的同一阶段里。

**`syncTools` 从此前的两阶段（获取并构建、交换）重构为明确的三阶段**（获取完整原始列表；先校验筛选器的引用再应用 `include`/`exclude`/`rename`/`describe` 并构建 `ToolDefinition`；交换世代），使筛选器的引用校验在任何单个工具的取舍决定之前、针对完整的服务器列表整体执行一次，与 `include`/`exclude` 无关——一个被排除但拼写错误的引用仍会被捕获，而不会因为它本来就不会被注册而被悄悄放过。构建阶段内部的重复公开名称检查现在也能捕获 `rename` 落在另一个（可能未改名的）工具名称上的情况，其消息也从"server listed tool more than once"泛化为同时指出解析后的公开名称及两种可能成因。

## Alternatives considered

- **一个独立的、模型可见的"工具目录"，由模型按需展开，把完整 schema 延后到被请求时才提供（按需展开目录模式）。** 本次改动中拒绝：这是一种不同的机制——它让每个工具在名义上仍可达，把成本从持续的 schema token 转移为一次目录查询轮次，而不是彻底移除部署从不希望可达的工具。对于希望保留广度而非固定筛选集合的部署，它仍是一个合理的后续方向，但不在本次范围内；在此记录，以免未来的改动从零重新发现这一需求。
- **在插件加载、连接之前就校验每一条 `tools` 引用。** 拒绝：此时尚未向服务器询问过其工具列表，因此没有可供校验引用的对象；这项检查要么是空校验，要么就需要为了校验而提前连接，与 `syncTools` 已经执行的连接重复。
- **对未匹配任何已发现 rawName 的 `include`/`exclude`/`rename`/`describe` 条目悄悄丢弃。** 拒绝：一个拼写错误或上游已改名的 rawName 会悄然失效，部署方也不会得到任何信号，说明其筛选配置已不再按 `cordis.yml` 所写的方式生效——这正是 `docs/AGENTS.md` 的"misconfiguration fails loud"约定要防止的静默收窄型失败。
- **为此单独设计一个 `ToolFilterMismatch` 之类的错误类型或独立失败路径，与既有的获取阶段抛错分开。** 拒绝：既有的抛错在初始连接、重连、重新同步三处已经有经过充分测试、易于理解的消费方；为了区分"是哪一项检查导致了拒绝"（日志消息文本已经承载了这一区分）而再设计第二种失败形态，需要在三个调用点各自新增处理。

## Consequences

一个 `tools.include` 只覆盖 Science 会话实际调用的论文检索工具的部署，能把一个 76 个工具、约 1.5–2 万 token 的工具清单，缩减为部署所命名的那几个，每一轮的工具选择噪声也随之等比例下降。`rename` 与 `describe` 让部署可以修正上游一个令人困惑的名称或描述，而无需 fork 或修补 MCP 服务器。现在，每一条 `tools` 引用都是 `cordis.yml` 中真正生效的一部分：如果在 MCP 服务器一侧改名或移除了某个工具，却没有同步更新部署的 `tools` 配置，此前静默无效的情形会变成一次失败的同步，并按重连策略重试——这是一次刻意的加固，而非回归，但也是维护该部署 `cordis.yml`、同时维护 MCP 服务器自身工具集合的人需要了解的运维事实。按 Schemastery 解析 `object`/`array`/`dict` 三种 schema 类型的方式，`tools` 字段的默认值（四个子字段均为空）在 `Config` 层面与"从未配置过筛选"是无法区分的——本仓库将其视为"省略即无操作"这一表达所必需且充分的形状，而非一处需要绕开的局限。

## Testing

`packages/mcp/mcp-client/tests/mcp-client.spec.ts` 覆盖了 `resolveToolFilter`（省略产出一个空的、无操作筛选器；`include`/`exclude`/`rename`/`describe` 解析为预期的 `Set`/`Map`；以及 rename 目标冲突时的抛错）以及 `syncTools`（单独的 `include`、`include` 后接 `exclude`、单独的 `exclude`、`rename` 改变公开名称的同时协议调用仍使用原始 rawName、`describe` 覆盖已注册的描述、一个失效的 `include` 引用拒绝并把 `include`/`exclude`/`rename`/`describe` 中所有缺失名称合并进同一条消息、以及重新同步时一个失效引用会保留上一世代的注册）。`packages/mcp/mcp-client/tests/apply.spec.ts` 覆盖了 `Config` schema 在省略时物化 `tools` 默认值并保留显式值，以及 `apply()` 在任何 effect 注册之前就对 `tools.rename` 冲突响亮失败。`packages/mcp/mcp-client/tests/reconnect.spec.ts` 覆盖了一个已配置的 `exclude` 在服务器于重连后声明了不同工具列表的情况下仍然生效，证明筛选器是被重新应用而非被重置。`packages/mcp/mcp-client/src/**` 上的覆盖率按本仓库的逐文件门槛达到 100%。
