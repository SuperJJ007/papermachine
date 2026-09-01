# Agent Note: Science preset 获得 Web 搜索/抓取与 plan mode

Status: implemented

[English](2026-09-01-science-web-and-plan.md) | 中文

## 问题

`science` preset 此前既没有通往外部 web 的路径，也没有 plan mode。当研究者要求 agent 查一个包的当前 API、某个方法的权威说明，或某数据集的文档时，模型没有任何工具可用——它要么凭训练数据猜，要么告诉用户自己查不了。同一个 preset 也跳过了 `planning`：一次多步分析——清洗数据、拟合或评估模型、产出图表——会直接冲进 `run_python`，代码在已绑定的 Conda prefix 上执行之前，没有任何供用户预先评审的计划。

这两处缺口是刻意留下的占位，不是疏忽：preset 自己的头部注释把「no delegation or Web search」列为一项限制，与 shell/写入/编辑/delegation 限制并列——这些限制才是 Science 真正的设计。

## 决定

**Science 组装自己的 `tool-web` 行，`fetch: true`，而每一个已发布的其他 preset（`standard`/`code`/`cordis`）都保持 `fetch: false`。** `run_python`/`run_r` 本就对着已绑定的环境执行任意代码，没有网络隔离（`docs/subsystems/science.md` Runtime 一节：文件写入限制「不隔离读、网络、系统调用或科学正确性」），因此 `web_fetch`——通过 `@deepseek-ai/dsh-web-fetch-http` 取回一个 HTTP(S) URL——不会给这个 agent 的执行路径带来它此前没有的暴露面。其余 preset 不变：它们的 `tool-web` 行仍和此前一样保持 `fetch: false`。

**`web-fetch-http` 现在挂载在 host 的 `dsh-base` bundle 层（`packages/bundle/base/cordis.patch.yml`），与既有的 `web-search-deepseek` 并列。** 该 provider 在本次改动之前未在仓库任何地方挂载；base bundle 自己的注释明确写着「no fetch provider is mounted」，并点名该 provider 自己文档记录的 SSRF 缺口（不拦截 private/loopback/link-local）作为原因。把它挂在 host 层一次，而不是逐 preset 各挂一份，是架构要求，不是偏好：`ctx.web` 是一个 host-root 单例 service（与 `web-search-deepseek` 既有的挂载位置一致），若把 provider 挂在某个 per-session preset 条目内部，每个并发挂载的 session 都会尝试在这同一个单例上注册同一个 provider id，第二个并发挂载就会抛出 `WEB_DUPLICATE_PROVIDER`。仅仅注册这个 provider 本身并不会把 `web_fetch` 暴露给任何 agent——只有某个 preset 自己的 `tool-web` 配置才会这样做，而目前只有 `science` 这样配置。

**Science 组装自己的一份 `planning` group 字面副本**，结构上与 `standard`/`code`/`cordis` 完全一致（在一个 entry-local `planMode` realm 下的 `cordis:group`，包裹 `@deepseek-ai/dsh-plan-mode`），只在其 `section` 文案中多加了一段，点名 Science 自己判断「何时需要先出计划」的门槛：三步及以上，或任何清洗数据、拟合或评估模型、产出图表的完整流水线。这与每个 preset 已经各自携带一份字面 `compaction`/`skills` 行、而非共享一份被 include 的片段的既有模式一致——这些 preset 保持各自独立可编辑，正是 [`packages/preset/agent-presets/README.md`](../../../../packages/preset/agent-presets/README.zh.md) 中不可复制 preset 理由所依赖的刻意逐字节复制。

**persona 增加两句话**：何时该用 `web_search`/`web_fetch`（一般性资料——方法背景、数据集文档、包/API 用法），何时该在有论文查找类 MCP 工具挂载时优先用它（按约定命名为 `mcp__papers__*`/`mcp__arxiv__*`，用于文献检索、引用查找或取论文全文），以及一条常驻指令：在把 web 或论文工具返回的内容用进分析之前，先点名其来源 URL 或引用。

**模型工具名单从十个增长到十三个**（不计条件性存在的 `glob`/`grep`）：`annotate_artifact`、`ask_user_question`、`exit_plan_mode`、`get_science_state`、`install_science_packages`、`read`、`read_image`、`run_python`、`run_r`、`skill`、`todo_write`、`web_fetch`、`web_search`。

## 备选方案

- **整体复用 `standard` 的名单（shell、写入/编辑、delegation），而不是组装一个更窄的集合。** 已否决：Science 的整体设计就是一个受限组合——只读文件系统、无 shell、无 delegation——而这次改动恰恰是在这个设计之上新增两项能力（web 读取、plan），而不是放弃这个设计。preset 自己的头部注释明确写了这一点。
- **只启用 `web_search`，像其他每个 preset 一样保持 `fetch: false`。** 已否决：与 `standard`/`code`/`cordis` 不同，Science 的 `run_python`/`run_r` 本就直接触达网络、没有沙箱化的出网控制，因此不给 `web_fetch` 换不来额外的隔离，却会挡住一个再普通不过的后续动作——去读某个搜索结果点名的具体页面。
- **把 `web-fetch-http` 挂在 `science` preset 自己的条目内部，像 `compaction`/`planMode` 一样隔离。** 已否决：`ctx.web` 不是一个 per-agent service——它就是 `web-search-deepseek` 已经注册进去的那同一个 host-root 单例。若按 preset-session 挂载 provider，每个并发挂载的 Science session 都会在同一个 provider id 上重复注册，第二个并发挂载就会抛出 `WEB_DUPLICATE_PROVIDER`。
- **加一条仓库级的「何时该出计划」补充，而不是一句 Science 专属的话。** 已否决：三步及以上/清洗-建模-出图这个门槛是 Science 专属的判断标准，不是通用 harness 默认值；其他每个 preset 的 `plan-mode` `section` 仍是逐字节相同的共享样板。
- **作为本次改动的一部分，搭建一个内置的 papers/arXiv MCP server。** 已推迟：仓库里目前没有这样的 server。persona 只点名了 `mcp__papers__*`/`mcp__arxiv__*` 这一命名约定，供将来若有这样的工具挂到该 preset 上时识别使用，因此这条指引眼下不是死重量，但它本身不引入任何新工具。

## 后果

`apps/cli/tests/web-agent-presets.e2e.ts` 中 `science` 的精确名单断言新增 `exit_plan_mode`、`web_fetch`、`web_search`；其隔离测试的禁止工具列表去掉 `web_search`（Science 现在与 `standard` 共享它），并另行断言 `standard` 没有 `web_fetch` 而 `science` 两者都有。`apps/web/tests/science-preset.snapshot.ts` 的名单断言同样更新；其 `session.jsonl` fixture 是在本次改动之前录制的，需要用真实 key 重新录制之后，该 suite 的 replay 模式才重新可信——这作为一项已知后续工作被记录下来，本次未执行（重录需要 `DEEPSEEK_API_KEY`，本次改动除 PR 中两次人工验证调用之外没有再做真实 API 录制）。`packages/bundle/base/package.json` 新增 `@deepseek-ai/dsh-web-fetch-http` 依赖；`docs/subsystems/science.md`/`.zh.md` 点名新的 preset 组合与不对称的 `fetch: true`。

## 测试

`packages/preset` 与 `apps/cli` 的 unit/e2e 套件、`examples/headless-agent` 的无密钥 snapshot 套件（不受影响：其 `science-tools` 场景直接组装 `dsh-tool-science`，而非 `science` preset，其基础 `cordis.yml` 也不包含本次改动的 `dsh-base` bundle patch）、`verify-cordis-config`，以及针对文档改动的 `verify-translation-pairing`/`verify-doc-refs`。具体运行的命令与一次针对 `science` preset、真实 key 下驱动 `web_search`/`web_fetch` 及一个触发 plan 的多步 prompt 的记录，见 PR 描述。
