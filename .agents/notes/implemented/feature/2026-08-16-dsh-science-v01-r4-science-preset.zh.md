# Agent Note: 在 RC5 上加入 DSH Science v0.1 R4 内置 Science preset

Status: implemented

[English](2026-08-16-dsh-science-v01-r4-science-preset.md) | 中文

## 问题

已验收的 DSH Science v0.1 产品线具备官方 RC5 基线、持久 Science Session 领域、Host 本地 Runtime 和面向模型的 Science Consumer，但没有随产品交付 `science` agent preset。部署可以手工组装 `@deepseek-ai/dsh-tool-science`，但随 CLI/Web 交付的 preset 根目录没有提供受限的 Science 名单，preset 选择器也没有 Science 项。因此，R3 仍是包级能力，不是应用组装。

下游 preset 候选 `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` 只能作为来源，不能作为可接受补丁。它属于被否决的 Phase 3 整段候选，早于 R3 要求的 `stateHistoryLimit`，并通过直接调用 prompt assembly 而非驱动真实模型请求来证明模型可见结果。复制它还会继承另一棵代码树中过时的生成物和文档假设。

R4 需要一个受限组装决策：让已验收的 R3 Consumer 可从随产品交付的 CLI/Web 应用中选择，规定其固定 Science 身份与 preset 创作的关系，并保持 Runtime 配置归 Host 所有。Preset 连线不得扩展为生产 invariant、无人消费的 Session projection、图表/Outcome 生产、Science 设置、Desktop 载体、Conda 发现或发布结论。

## 决策

R4 加入内置 `science` preset、针对其固定持久身份的显式不可复制策略、内置项本地化文案、解析与包元数据、浏览器回放 fixture，以及应用级无密钥 Web snapshot。该 preset 保持显式选择，`standard` 继续作为默认项。R4 只关闭 `SCI-PRESET` overlay 行；`SCI-CHARTS-OUTCOME`、`SCI-SETTINGS-SIDEBAR` 与 `DESKTOP-CARRIER` 保持开放。

[R0 overlay 清单](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.zh.md#complete-overlay-inventory)持有依赖顺序与证据层划分。[R1 Science Session 决策](2026-08-15-dsh-science-v01-r1-science-session.zh.md)持有持久 Science 事件与 replay。[R2 Science Runtime 决策](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md)持有显式既有 prefix 配置与进程生命周期。[R3 Science 工具决策](2026-08-16-dsh-science-v01-r3-science-tools.zh.md)持有 Consumer、runtime context 恢复、只读文件系统入口和模型可见 schema/结果。R4 组装这些已验收职责，不修改它们的包 API 或持久 Science 事件字段。

<a id="exact-identities"></a>

### 精确身份

| 对象 | 身份 | R4 用途 |
|---|---|---|
| 官方源码基线 | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，版本 `0.1.0-rc.5` | 不可变的上游产品基线 |
| 已验收 R3 文档收口 head（R4 plan base） | `92ee890e8da762ba789e74610551b4fd3351ed27` | R4 实现的精确起点 |
| 修复后的 R4 行为 candidate | `cda69a9e5f6fb729c4699f70e06dc23745f0788f`，位于 plan base 之上九个线性 commit | 最终复制策略修复后的精确已验收源码行为 |
| 下游 preset 来源 | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`；仅 preset commit | 只读名单、locale 与测试输入；不继承补丁或验收 |
| 被否决的下游区间 | 截止 `fae091e1080e830bed8ad0456e4cbced29101b01` 的 Phase 3 区间 | 仅用作负向范围与评审证据 |

下游测试、snapshot、评审结论、真实机器报告、脏 worktree、RC6 artifact 或更晚的上游源码都不是 R4 验收证据。[带日期的 R4 evidence 记录](../../../../docs/evidence/2026-08-16-dsh-science-v01-r4-science-preset.zh.md)持有九个 commit 身份、worktree 状态、精确工具链、命令、结果、平台事实、例外和 `NOT-RUN` 层。

### 范围

| 方向 | 区域 | R4 结果 |
|---|---|---|
| IN | `SCI-PRESET` | `apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}`，包含精确受限名单、项目指令、元数据与显式 Science Consumer 策略 |
| IN | 可安全复制的 preset 创作 | 通用且显式的 preset 可复制字段，仅健康 preset 默认允许复制；随附元数据必须存在且通过校验，每个损坏来源都 fail-closed，内置 `science` 元数据禁止复制，`ctx.agentPresets.copy()` 与 `agentPreset.copy` 拒绝复制，Web 不提供可执行的复制路径 |
| IN | 应用集成 | `apps/cli` 依赖、lockfile importer 变化、preset 发现、内置项本地化文案和聚焦 CLI/client 组装测试 |
| IN | 浏览器与模型可见验收 | 更新随附名单的 ARIA golden，并新增无密钥 `apps/web` snapshot：挂载精确随附 preset，通过 Web scaffold、Loader、preset registry 与 agent loop 驱动真实请求 |
| IN | 当前文档与收口 | 受影响的包/应用文档和生成物、本 Note 的生命周期变化，以及带日期的 R4 evidence 记录 |
| OUT | 生产 invariant 与 projection 组装 | `@deepseek-ai/dsh-invariants`、所有 `*/invariant` 行，以及在没有随附 Web 读路径消费可选 projection 时加入的 Host `@deepseek-ai/dsh-science-session` 行 |
| OUT | Runtime 默认值与环境管理 | `science-runtime` Host 行、真实路径、profile 发现、Conda 创建/克隆/安装/更新/修复/删除、隐式 profile 选择、凭据或 provider 默认值 |
| OUT | R1–R3 行为变化 | Science 事件 schema/fold、Runtime 操作、runtime context 恢复、文件系统只读实现，或 Science 工具 schema/结果 |
| OUT | 后续 Science 产品工作 | `save_chart`、chart renderer、`science/chart-saved` producer、Outcome 发布、设置 projection/card、Science sidebar/Details UI、持久 kernel、包管理与发布工具 |
| OUT | 分发与迁移 | Desktop 载体、installer、签名、公证、Authenticode、npm 发布、tag、GitHub release、Git push/PR、采用 RC6 或迁移到最新上游 |

### Preset 身份、元数据与名单

Preset id 为 `science`，显示顺序为 `5`，应用默认项仍为 `standard`。其 `preset.yml` 元数据遵循随附约定使用中文：`name: Science 模式` 与 `description: 面向可复现 Python/R 分析的受限 Agent，提供只读工作区、技能和持久 Science 状态工具。` Web 针对该 system-trusted 行将英文 locale 本地化为 `Science mode` 与 `Restricted agent for reproducible Python/R analysis with a read-only workspace, skills, and durable Science state tools.`，中文 locale 使用同一中文文案；具有相同 id 的 user-authored preset 继续按既有 trust 规则保留自己的元数据。

`@deepseek-ai/dsh-tool-science` 行设置 `profileId: science`、`modeRevision: science-v1` 与 `stateHistoryLimit: 8`。这些值是显式 preset 策略，不是包默认值或环境发现。History limit 分别限制 `get_science_state` 返回的近期 run 与 chart version；修改它会改变模型可见输出，必须同步更新决策、文档与 snapshot。

Preset 组装 Science persona、设置 `maxBytes: 65536` 的 `@deepseek-ai/dsh-agent-instructions`、`@deepseek-ai/dsh-tool-science`、`@deepseek-ai/dsh-tool-fs/read-only`、`@deepseek-ai/dsh-tool-fs-search`、位于同一 isolated realm 的 basic compaction/compact command/result pruner、`@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-skill`、`@deepseek-ai/dsh-tool-ask-user` 与 `@deepseek-ai/dsh-tool-todo`。因此，Science session 将适用的项目 `AGENTS.md` 指令作为模型可见 prompt 内容。无密钥 snapshot 与 Science persona 一同固定这些指令是否出现，不用工具名单断言代替 prompt 覆盖。

在具备图片 attachment 与随附 ripgrep 的 Web Host 中，精确模型工具名单为 `ask_user_question`、`get_science_state`、`glob`、`grep`、`read`、`read_image`、`run_python`、`run_r`、`skill` 与 `todo_write`。名单排除 bash/pwsh、文件系统写入/编辑、`str_replace_editor`、jobs、Goal、plan mode、subagents、workflows、Ralph、Code Mode、self-modification、Web search、chart/Outcome 发布，以及所有未在上文点名的工具。`apps/cli/tests/web-agent-presets.e2e.ts` 断言组装后的名单与每个 preset 的作用域；YAML 中没有某行不能单独作为证据。

R1 与 R3 刻意把 `ScienceModeRef.presetId` 和 Consumer 资格绑定到字面 `science` preset。逐字节复制出的 `science-copy` 会挂载三个 Science 工具，却无法绑定或执行它们。R4 不把这条用户可达故障伪装成成功创作：preset 元数据新增显式 `copyable` 布尔值，`science/preset.yml` 设置 `copyable: false`，服务与 Host API 以点名来源的诊断拒绝直接复制请求（`PresetNotCopyableError`，wire 代码 `agent-preset-not-copyable`），Web 以本地化原因（`notCopyable`，独立于损坏 preset 的 `brokenNoCopy`）禁用 Science 复制操作。健康的用户 preset 可以省略元数据并默认为可复制；随附 system preset 必须提供可读取的 map 元数据，声明的 `copyable` 必须是布尔值，每个损坏 preset 都解析为不可复制。因此，策略缺失、YAML 损坏、无法读取、顶层类型错误或字段类型错误都会在 discovery 与直接创作中 fail-closed。[仅复制创作决策](../simplification/2026-08-08-copy-only-preset-authoring.zh.md)继续持有创作机制；支持派生 Science preset id 仍须另行决定 R1/R3 持久身份。

### Host、Session 与 Runtime 归属

Science 事件准入在 R4 之前已经是仓库构建事实。`packages/core/session/src/known-event-types.ts` 从合并后的 `SessionEventMap` 生成，已经包含全部六种 `science/*` 类型；Web Host 组装因 R4 而既不准入也不拒绝这些类型。

R4 不在随附 Web Host 中挂载 `@deepseek-ai/dsh-invariants` 或任何 `*/invariant` companion。这些 companion 通过 `scripts/test-invariants.ts` 在 Vitest Host 运行；让它们进入生产组装仍是一项独立的性能与失败策略决策，因为每个事件都会执行严格关系检查。

R4 也不在 Web Host 中挂载 `@deepseek-ai/dsh-science-session`。其运行时 `apply` 只在存在 `ctx.sessionProjections` 时注册可选 `science` projection，而 R3 Consumer 直接用 `replayScience(session.events)` 重建 context 与 state。R4 没有 Web 读路径消费该 projection 或 checkpoint。未来需要增量 Science projection state 的设置/sidebar、transcript 或 query 表层，必须持有该 Host 行及其 checkpoint 证据。

`ctx.scienceRuntime` 仍是显式部署配置。可用部署必须挂载 `@deepseek-ai/dsh-science-runtime`，且存在 id 精确为 `science` 的 profile；preset 不携带路径、不选择第一个已配置 profile，也不制造 fallback。

R4 接受"可见但依赖部署"的内置 preset。没有 Science Runtime 的默认 Web 部署可以发现并选择 `science`，但首次真实 Science assembly 会在 environment event、request header 或 provider call 之前失败。错误点名缺失的 Host service（`ctx.scienceRuntime`）或缺失的 `science` profile——已在 `apps/cli/tests/web-agent-presets.e2e.ts` 中确认；R4 不隐藏 preset、不静默切换到 Standard、不发现机器路径，也不宣称部署已具备 Science 能力。一次性 mode binding 可能已经持久化，此时恢复而非回滚。

内置 `modeRevision: science-v1` 是持久身份。绑定到其他 revision 的 session 按 R3 规则继续明确失败。未来修改 revision 必须决定拒绝、迁移或分叉 preset 身份；只修改 YAML 字符串不是兼容升级。

### 应用与 snapshot 证据

主要应用级无密钥 snapshot 为 `apps/web/tests/science-preset.snapshot.ts`。它沿用 `apps/web/tests/minimal-preset.snapshot.ts` 的路径：以 replay fixture 与 fake-backed（真实 `@deepseek-ai/dsh-science-runtime`、fake subprocess/sandbox provider，通过 `ctx.isolate('subprocess').isolate('sandbox')` 隔离）Runtime 启动随附 Web scaffold，创建 header 指名 `science` 的 Agent，并通过 `ctx.agentPresets.mount(agentCtx, 'science')` 挂载精确随附 preset。它不在 headless 示例或测试专用 Cordis 组装中复制名单。

Loader、随附 preset registry/mount、agent loop、Session store、system-prompt pipeline、工具执行与模型请求都保持真实。Web Vitest config 不挂载 `scripts/test-invariants.ts`；关系 invariant 证据留在其 owner unit lane，既不是本应用 snapshot 的一部分，也不是增加 Host 行的理由。

可运行场景发送一次请求，并捕获 Science persona、适用的项目指令、`science:environment` runtime-context message、精确工具 schema/名单、`get_science_state` 结果，以及从 `science/mode-bound`、`science/environment-bound` 到 `request/header` 的顺序。模型可见输出中不出现 Host 路径或 Runtime 专属身份字段。

既有浏览器 lane 直接读取真实随附 preset 根目录。`apps/web/tests/agent-preset-selection.e2e.ts`、`apps/web/tests/agent-preset-authoring.e2e.ts` 及其 `menu.expected.md`、`section.expected.md` ARIA golden 展示第五个内置 preset、本地化文案、顺序、默认项保持，以及禁用的 Science 复制操作。`apps/cli/tests/web-agent-presets.e2e.ts` 另行证明精确 Science/Standard 名单隔离、Runtime 缺失时明确失败、fake-Runtime Science 请求成功，以及 disposal 隔离。

### 验证与收口

修复后行为 candidate 上的 R4 源码证据包括 copyability/API/client unit 套件（378 个测试，17 个文件）、CLI e2e 组装文件（38 个测试）、两条 Web 浏览器 lane 与 Web snapshot（14 个测试）、已构建 artifact 的 lib-mode snapshot、Node 24 Host build、五项 artifact 检查（其中 sandbox 阻塞的 built-bin 命令在 Host 上原样重跑）、`verify-cordis-config`、`doc-sync` 与 lint。最终验收 audit 否决了此前 candidate，因为损坏或缺失的策略可能 fail-open，且 Science 工具 README 仍称 schema 全局生效。本次修复让损坏行不可复制、要求随附元数据合法、通过真实 CLI 组装覆盖随附策略缺失／格式错误／类型错误，删除过期限制，并重新生成受影响目录。对修复范围的最终语义与 diff 复审未发现剩余 blocker 或 high-severity finding。历史 repository-wide hygiene 例外与本次修复分层处理。[带日期的 R4 evidence 记录](../../../../docs/evidence/2026-08-16-dsh-science-v01-r4-science-preset.zh.md)把每项结果与例外绑定到 `cda69a9e5f6fb729c4699f70e06dc23745f0788f`。

真实 Python 与 R Consumer acceptance 针对明确授权的既有 Conda prefix，对 R4 仍为 `NOT-RUN`。Desktop、provider credentials、签名、发布与 release 仍为 `NOT-RUN`。

### Supersession 与生命周期

R4 不 supersede R1 Science Session、R2 Science Runtime 或 R3 Science 工具决策。它消费三者的公开职责，并用第一个随产品交付的应用组装完成已验收的 Science 产品线。通用 `copyable` preset 元信息机制扩展当前 preset 创作约定；[仅复制创作决策](../simplification/2026-08-08-copy-only-preset-authoring.zh.md)继续独立有效。

下游 Phase 3 preset commit 是被排除谱系的 provenance，未被复制到 active tree。在 settings/sidebar、chart/Outcome、Desktop、artifact 与 release 层各自通过自己的决策与证据之前，项目文档不得宣称 Science Mode 已 release-ready；部署仍必须挂载带 `science` profile 的 `@deepseek-ai/dsh-science-runtime`，Science session 才能完成一次真实请求。

## 考虑过的替代方案

**Cherry-pick 或复制下游 preset commit。** 否决，因为 `fae091e...` 属于整段失败的候选，缺少 R3 要求的 `stateHistoryLimit`，使用直接 assembly snapshot，并携带另一棵代码树的生成物/文档假设。它的行只用于重新判断，不是实现或证据范围。

**在 Web Host 挂载 Science Session 和 invariant companion。** 否决，因为事件准入已经来自生成的仓库事件集合，R3 Consumer 直接 replay Session，且 R4 没有 Web reader 消费可选 projection。生产关系检查与 projection checkpoint 必须各自拥有明确 consumer、成本和失败策略决策。

**允许通用复制流程创建 `science-copy`。** 否决，因为 R1 持久化字面 `presetId: 'science'`，R3 也按字面 Session header 判定资格。挂载可见工具却拒绝每个 Science 操作的副本，违反"副本与来源同等可加载"的 preset 创作承诺。R4 在 metadata、service、API 与 UI 层把 Science 标记为不可复制；扩展持久 Science 身份属于另一项工作。

**把 Runtime profile 或 Conda 发现放入 preset。** 否决，因为 preset 挂在 agent plane，而 `ctx.scienceRuntime`、既有 prefix allowlist、进程 confinement 与机器路径属于 Host 部署。面向模型的组装不得发现或修改执行环境。

**Runtime 缺失时隐藏 preset。** 否决，因为当前 preset registry 没有 Host 能力资格谓词，增加 settings/sidebar 可用性状态会跨入 `SCI-SETTINGS-SIDEBAR`。R4 接受确定性发现，以及点名缺失 service 或 profile 的首次使用诊断；未来产品决策可以增加可用性展示，但不得削弱 Runtime 归属。

**纳入 chart 与 Outcome 发布。** 否决，因为 R0 依赖顺序要求先验收 preset，再对模型可见结果与 renderer 归属另行决策。R4 只提供此前置条件，在新增持久 producer 或 renderer 前停止。

**使用 headless 示例或直接 prompt assembly 作为应用 snapshot。** 否决，因为 preset registry 由 Web bundle 随产品交付，既有 Web scaffold 已能执行该精确根目录。并行 headless 组装或直接 assembly 即使通过，也不能证明随附 registry、浏览器应用、request-context 日志、request header 或 Session 重建。

**把 Science 设为默认 preset。** 否决，因为 R4 新增的是 Runtime 由部署提供且可能不可用的显式选择能力。改变默认项会影响每个新 session，并混淆源码组装与部署就绪。

## Consequences

R4 让 Science 产品线获得第一个随产品交付的应用组装，且不引入下游历史。Preset 根目录把 `science` 列为显示顺序 `5` 的 system preset，携带已决定的中文 fallback 元数据；`standard` 仍是组装与设置默认项。Science preset 提供 `profileId: science`、`modeRevision: science-v1`、`stateHistoryLimit: 8`、项目 `AGENTS.md` 指令与精确获批工具名单，不贡献 process-global service 或禁用工具。通用 preset 约定让健康用户 preset 默认可复制、要求随附 preset 提供合法元数据、把每个损坏 preset 解析为不可复制，并接受健康 preset 的显式 false。Science 声明 false；直接 service/API 复制以点名来源的诊断失败，Web authoring golden 不出现已启用的 Science 复制操作。随附 Web Host 不增加 invariant、invariant companion 或 Science Session projection 行，生成的 known-event types 保持事件准入权威。它在 R4 阶段也不增加 Runtime 行；base Host 组装至今仍不增加，但 [R6](2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 之后专门在随附 Web bundle 中挂载了一个 settings-bound、有意未配置的 `@deepseek-ai/dsh-science-runtime/with-settings` 行。Runtime service 或 `science` profile 缺失时在任何 provider request 前失败，点名缺失 Host 对象，且绝不回退到其他 profile、Standard mode 或发现出的机器路径。`apps/web/tests/science-preset.snapshot.ts` 挂载精确随附 preset，并记录真实模型请求；其中 persona、项目指令、runtime context、工具、结果与持久事件可以相互重建，且不含 Host 路径。两条既有 Web 浏览器 lane 与 ARIA golden 按顺序展示五个内置项、本地化 Science 文案、保留的 Standard 默认值，以及禁用的 Science 创作操作。

没有 Science Runtime 的 Host 仍可发现该 preset，因此用户可能选择一个首次真实请求会失败的模式；R4 在诊断能于 provider call 前点名缺失 service 或 profile，且不作就绪声明的前提下接受这项产品取舍。通用 copyability 字段同时改变 preset、Host API 与 client 行为——unit、wire 与 browser 证据彼此一致，补上了仅 UI 检查或仅 service 检查都会留下的缺口。手工复制文件系统目录仍可绕过 `agentPreset.copy`，并产生不合资格的 Science 组装；在另行决定持久身份并支持派生 Science id 之前，mount 或首次使用继续保留 R3 的字面身份诊断。`science-v1` 是持久 Session 身份，偶然修改字符串会按 R3 刻意 mismatch 规则搁置可恢复 Session，因此 revision 变化需要单独的兼容性决策。受限名单放弃 shell、mutation、delegation、Web search 与 chart publication；为方便而加入任一能力会改变产品/安全承诺，必须显式评审，不能只改 YAML。R4 没有生产 projection consumer——未来若没有具体 Web 读路径就加入 `@deepseek-ai/dsh-science-session`，会增加 checkpoint 工作与 Host 范围事件处理，却没有对应产品行为。

R4 收口只改变 `SCI-PRESET`；chart/Outcome、settings/sidebar、Desktop、真实 provider、发布、tag、push 与 release 都不在验收结论内，与 R0–R3 overlay inventory 中记录的一致。
