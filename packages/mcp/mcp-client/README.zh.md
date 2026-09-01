# @deepseek-ai/dsh-mcp-client

[English](README.md) | 中文

MCP 客户端桥接插件：连接外部 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器，把它们的工具注册到 `ctx.tools`，使模型能够通过服务器限定名称（`mcp__<serverName>__<rawName>`）将其作为原生工具使用。

## 用法

`cordis.yml` 中每个 MCP 服务器使用一个插件实例：

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

模型会看到 `mcp__github__create_issue`、`mcp__web__search` 等工具，这与 Claude Code 和 Codex 使用的服务器限定形状相同。HMR（热模块替换）支持热替换：编辑配置项会触发断开 + 重新连接，无需重启进程；`serverName` 不变时会生成完全相同的工具名称。

## 配置

| 字段 | 传输 | 必填 | 描述 |
|---|---|---|---|
| `transport` | 两者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `serverName` | 两者 | 是 | 该服务器面向模型工具名称的 namespace；`[A-Za-z0-9_-]{1,32}`，在存活实例中唯一 |
| `command` | stdio | 是 | 要 spawn 的可执行文件 |
| `args` | stdio | 否 | 传给命令的参数 |
| `env` | stdio | 否 | 合并到已清理环境中的额外环境变量 |
| `cwd` | stdio | 否 | 子进程工作目录 |
| `url` | http | 是 | MCP 服务器 URL |
| `headers` | http | 否 | 额外标头（例如认证 token） |
| `toolCallTimeoutMs` | 两者 | 否 | 每次 `callTool` 调用的超时（默认 60000） |
| `failOnStartupError` | 两者 | 否 | 初始连接或工具同步失败时拒绝插件激活（默认 `false`） |
| `reconnect.enabled` | 两者 | 否 | 连接丢失后自动重新连接（默认 `true`） |
| `reconnect.initialDelayMs` | 两者 | 否 | 首次重连延迟（毫秒）；每次连续失败尝试翻倍（默认 500） |
| `reconnect.maxDelayMs` | 两者 | 否 | 退避上限（毫秒）；同时也是重置尝试预算所需的正常运行时长（默认 30000） |
| `reconnect.maxAttempts` | 两者 | 否 | 每次中断期间连续失败尝试次数上限，超出后彻底放弃（默认 10） |
| `tools.include` | 两者 | 否 | 只注册这些服务器已声明的 rawName；省略则注册全部已发现工具 |
| `tools.exclude` | 两者 | 否 | 在 `include` 缩小集合之后再剔除的 rawName；省略则不剔除任何工具 |
| `tools.rename` | 两者 | 否 | rawName → 公开名后缀覆盖，仍会像其他工具名称一样被规范化 |
| `tools.describe` | 两者 | 否 | rawName → 面向模型的描述覆盖 |

## 工具命名

每个 MCP 工具都有两个名称：通过 `tools/call` 在协议上传送的原始 MCP 名称，以及公开名称 `mcp__<serverName>__<rawName>`，后者注册到 `ctx.tools`。公开名称会规范化为 DeepSeek 函数名称约定（64 个字符、`[A-Za-z0-9_-]`）；如果替换或截断改变名称，就会追加 `(serverName, rawName)` 的确定性 12 位十六进制 hash，确保不同工具绝不会折叠为同一个名称。名称是 `(serverName, rawName)` 的纯函数：连接顺序、重新同步和其他服务器永远不会重命名工具。`tools.rename` 条目只在这一步推导中用其后缀替换 rawName；`tools/call` 在协议上发送的原始名称不受影响。

- 发布相同原始名称（例如 `search`）的两个服务器会在各自 namespace 下共存。
- 存活实例中的重复 `serverName` 会使后加载的插件实例失败。
- 服务器在工具列表中两次列出同一工具名称时，该列表会作为无效工具列表被拒绝。
- 外部注册抢占该服务器 namespace 时，会回滚整个世代（绝不保留部分集合），并明确报错。
- `tools.rename` 条目与另一工具的解析后公开名称冲突时——服务器两次列出同一 rawName、两个 rawName 改名到同一后缀、或改名后落在另一未改名工具的名称上——会以同样方式回滚整个世代。

## 工具筛选

`tools.include`/`exclude`/`rename`/`describe` 是部署级、"模型之外"的决定：哪些服务器工具能到达模型、以什么名称、附带什么描述——绝非按请求或由模型自行选择。这四个字段都是可选且相互独立的；完全省略 `tools` 会按服务器提供的名称和描述注册全部已发现工具，行为不变。

- `include` 先生效：非空时只有列出的 rawName 通过。`exclude` 随后从剩余集合（若无 `include` 则从全部已发现集合）中剔除 rawName。
- `rename` 只在推导公开名称（`mcp__<serverName>__<suffix>`，规范化方式与其他工具名称相同）时用其值替换 rawName；不改变协议上发送的名称。
- `describe` 替换注册时使用的面向模型描述；该工具的服务器自带描述不再使用。
- **校验分两阶段，与上文的命名及重连失败语义一致。** `rename` 目标唯一性仅取决于配置本身，在插件加载时校验，早于任何 effect 注册——两个不同 rawName 改名到同一后缀会立即拒绝插件激活，与服务器实际声明什么无关。其余每项校验都需要一份存活的工具列表，因此运行于每次 `syncTools` 同步（初始连接、重连、`notifications/tools/list_changed` 重新同步皆同）：`include`/`exclude`/`rename`/`describe` 中任何一处引用的 rawName，若连接的服务器实际并未声明，就是一次明确记录日志的响亮失败，形态与其他任何获取阶段同步失败相同——该次同步的 promise 会 reject，因此初始连接会按重连策略重试（或在 `failOnStartupError` 为 true 时使插件激活失败），而 `notifications/tools/list_changed` 之后的重新同步会保持上一世代的注册不受影响。筛选器本身绝不会为跳过一个错误引用而被悄悄收窄。
- 已解析的筛选器在插件加载时确定，并在每一代连接上原样重新应用，包括重连之后：服务器恢复后带回不同的工具列表，仍由同一份 `include`/`exclude`/`rename`/`describe` 筛选，而非被重新配置。

## 行为

- 连接时：插件激活会等待 `listTools()`，应用已配置的工具筛选器，并在组合开始首个轮次前通过 `ctx.tools.register()` 为每个存活下来的工具注册其公开名称。初始连接、发现、筛选器校验或注册失败始终会记录日志；`failOnStartupError` 为 true 时拒绝激活，否则插件仍会激活但不注册工具。
- 监听 `notifications/tools/list_changed` → 重新同步，并重新应用同一个工具筛选器；获取阶段失败（包括筛选器引用失效）时保留上一世代的注册，注册冲突则会回滚本次尝试的世代，并且不保留该服务器的任何工具。
- 工具执行：`client.callTool({ name: rawName, arguments }, { signal })`，支持超时 + 中止；公开名称绝不会发给服务器。
- 规范成功值是 `{ content: JsonValue[], structuredContent? }`；完整的 JSON MCP 块会保留给编程调用方。受支持且已声明的 `outputSchema` 会验证 `structuredContent`；不受支持的 schema 词汇会回退为不受约束的 `JsonValue`。
- Native／模型渲染会保留 MCP 块顺序。文本类连续块以换行连接；资源链接以文本保留名称和 URI；只有挂载 `ctx.attachments` 且确切调用模型路由明确声明支持图片输入时，受支持的图片才会成为持久核心图片块。整个图片批次会先完成解码与准入，再保存任一成员。格式错误或被拒绝的图片批次、音频、嵌入资源和不受支持的块会成为明确诊断文本，而不会消失。
- 断开／崩溃时：supervisor 以指数退避（`reconnect.initialDelayMs` 逐次翻倍，上限 `reconnect.maxDelayMs`）重启原始服务器配置，成功后重新执行发现并重新应用同一个工具筛选器——恢复的世代会替换前一个，因此工具既不会重复也不会泄漏。中断期间最后一个正常世代保持注册；针对它的调用在恢复前会失败。
- 重连按中断预算控制：连续失败达到 `reconnect.maxAttempts` 次后，该服务器的工具会被注销，重连停止，直到 HMR 重载或重启 Host。连接存活超过 `maxDelayMs` 会重置预算，因此偶尔崩溃的服务器可以无限恢复，而崩溃循环的服务器——即使短暂连接成功——仍会耗尽上限而非永远重启。
- 重连状态在日志中对用户可见：reconnecting（warn，含尝试次数和延迟）、recovered（info）、最终失败和 disabled-loss（error）。dispose（资源释放）会取消任何待执行的重连。设置 `reconnect.enabled: false` 时，连接丢失后工具保持注册但调用失败，直到重载——即手动恢复行为。

## 消费的服务

| 服务 | 用途 |
|---|---|
| `ctx.tools` | 注册／注销 MCP 工具 |
| `ctx.attachments` | 可选；在模型投影前校验并持久保存图片结果批次 |
| `ctx.llm` | 可选；证明确切调用路由明确支持图片输入 |

## 模型体验

### 已发现的 MCP 工具

#### 模型看到的内容

初始发现成功后，每个通过了已配置 `tools.include`/`exclude` 筛选的已声明 MCP 工具，都会显示为名为 `mcp__<serverName>__<rawName>`（或其 `tools.rename` 后的、或确定性规范化的形式）的原生工具，并携带服务器提供或被 `tools.describe` 覆盖的描述，以及服务器的输入 schema。使用经过筛选的 `tools` 配置部署的模型永远不会看到被剔除工具的名称、描述或 schema——被剔除的工具不消耗任何 token。成功的重新同步——包括自动重连后的同步——会以同一个筛选器替换整个世代；对插件执行 dispose（资源释放）或重连预算耗尽会移除该世代。

#### Token 影响

工具注册期间，每次请求都会承担数据相关的 schema 成本。重新同步会替换而非累积 schema，服务器限定名称也会为每个工具定义和调用增加 token。

#### KV Cache 影响

只要已发现工具集合及其 schema 不变，前缀就保持稳定。增加、移除、重命名或更改工具的重新同步会替换定义，并可能使从第一个变化的 schema token 起的复用失效；恢复了未变列表的重连会生成完全相同的定义，前缀保持稳定。

### 工具调用历史与结果

#### 模型看到的内容

公开工具名称和 JSON 参数会保留在 assistant 历史中。执行局部的规范值始终为程序化调用方和 Code Mode 保留完整 JSON MCP 块及可选结构化内容。在 Native 上下文中，受支持的图片块会在确切路由能力得到证明后，按原始顺序与文本一起持久投影；Code Mode 还会经外层 `run_code` 结果转运这份已经结算的丰富投影，而不改变规范绑定值。被拒绝的图片、音频、嵌入资源、资源链接和未知块会继续以有界文本诊断可见；MCP `isError` 会在持久化图片前拒绝调用。

#### Token 影响

参数、映射后的文本和持久图片引用会保留到压缩（compaction）发生时。内联 MCP base64 只存在于执行局部的规范值中，绝不会复制进会话事件；提供方会从附件存储读取经过校验的字节。音频和嵌入资源载荷仍不会进入模型上下文。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与暂缓事项

- **只桥接 MCP 的工具能力**：资源和提示词没有 harness 消费接口，暂缓实现。
- **启动超时继承自 MCP SDK**：DSH 尚未公开连接／发现超时。每次 initialize 请求或分页 `tools/list` 请求都使用 SDK 默认的 60 秒，因此在初始同步完成期间，无响应的 server 或 cursor chain 可能同时延迟激活与 teardown。
- **重连在传输关闭时触发**：崩溃的 stdio 子进程会触发重连；Streamable HTTP 失败通过每次请求以及 SDK 传输自身的 SSE（Server-Sent Events）流恢复机制暴露，因此不可达的 HTTP 服务器会按调用重试，而非由 supervisor 重新 spawn。
- **图片是唯一的持久丰富结果桥接**：PNG、JPEG、WebP 和 GIF 可以在确切能力得到证明后进入 Native 上下文。音频和嵌入资源载荷仍只存在于执行局部，并配有明确诊断；资源链接只以文本保留名称和 URI。
- **不强制执行不受支持的 MCP 输出 schema**：已声明 schema 使用 harness 子集之外的词汇时，`structuredContent` 会回退到 `JsonValue`。
- **工具筛选由部署固定，而非模型驱动**：`tools.include`/`exclude`/`rename`/`describe` 在 `cordis.yml` 中一次性设定，并原样重新应用到每次同步。目前没有让模型按名称请求一个被剔除工具、或在运行期扩展某个已筛选集合的机制（按需展开目录模式，不同于本筛选器，属于后续机制）。
