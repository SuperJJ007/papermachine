# Agent Note: DSH Science v0.1 R6 设置与 Details

Status: proposed

[English](2026-08-17-dsh-science-v01-r6-settings-details.md) | 中文

## Problem

Science 路线已经验收 Session、Runtime、模型工具、preset 与持久 chart/Outcome 层。已交付 Web 应用仍没有面向用户的路径来配置 `science` Runtime profile、查看该 profile 是否已配置，或在单个 tool occurrence 之外检查当前 Science Session。用户选择 Science preset 后可能只得到首次使用 Runtime diagnostic，却没有设置路径；完成分析后也没有当前状态侧栏。

R6 只能关闭 `SCI-SETTINGS-SIDEBAR` inventory 行。它必须保留 Runtime 对既有 Conda prefix 的归属，阻止绝对 Host 路径进入模型与浏览器可读状态，复用持久 `science` Session projection，并扩展现有 settings 与 Details 插件点，而不是替换其 shell。R6 不得重开已验收的 R5 决定，也不得把设置扩展成 Conda 发现、包安装、环境变更、Desktop 或发布工作。

## Proposal

在 R5 收口 head `16f5ce76abf8483c42bf02214cf15d82a2300b9c`——即已验收产品 candidate `69045ba510f90380f5ed83ca1acbd955e7178fbf`，外加单独验收的 R5 module-graph 更正 `58aee8561ca665fc7056f2dc013e7012aafc4da5` 加上其 implemented Note 与 dated evidence——之上，用三个分别验收的检查点实施 R6：Runtime settings 归属、通用 Details 路由，以及 Science settings/Details 产品表层。Web bundle 将挂载一个刻意未配置的 Science Runtime，为已交付的 `science` profile 提供专用 Science 设置页，并在现有右侧 Details column 中增加 Science entry。Headless 与自定义 deployment 继续显式提供 Runtime composition。

R6 改变设置路径，不改变执行权威。用户可以为固定 `science` profile 填写既有 Python 与 R Conda 的绝对 prefix，然后重启 Host。Runtime 继续按 R2 规则观察、约束并执行这些 prefix；它不发现、创建、clone、求解、安装、更新、修复或删除环境。Science Details entry 保持只读，从已验收且对 Client 安全的 Session projection 派生 mode、environment summary、runs、charts 与最新 Outcome。

### Planning identity and start conditions

| Subject | Identity or rule | R6 use |
|---|---|---|
| 已验收产品基线 | [R5 closure](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md) head `16f5ce76abf8483c42bf02214cf15d82a2300b9c`，其绑定的产品 candidate 为 `69045ba510f90380f5ed83ca1acbd955e7178fbf` | 唯一 R6 实施基线 |
| R6 inventory 行 | [`SCI-SETTINGS-SIDEBAR`](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | 唯一产品 delta |
| Runtime authority | [R2 Science Runtime](../../implemented/feature/2026-08-15-dsh-science-v01-r2-science-runtime.md) | 既有 prefix 观察、执行、约束、lease 与真实 Python/R 验收继续由其归属 |
| 已交付 composition | [R4 Science preset](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) 加已验收的 R5 composition | 保留固定 `science` preset identity，只增加 R6 Host/Client rows |
| R5 dependency | [R5 charts and Outcome](../../implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md) | R6 所依赖的持久 chart/Outcome 语义、`ui-science` 与对 Client 安全的 projection |
| 下游 source | 无 | 全新的 RC5-line 产品决定；不继承下游实现或证据 |

R6-0 是 hard stop，而不是实施检查点。修改 source 之前，在准确的起始 tree 上确认 worktree 干净、R5 Note 位于 `implemented/feature`，且 dated R5 evidence 绑定本 Note 指明的同一 head。在该 head 上重新检查 wire projection；若它暴露 `configuredPrefix`、`canonicalPrefix`、`executable`、其他绝对 Host 路径或未脱敏的完整 environment fingerprint，则拒绝该基线。R5 交付的对 Client 安全 projection 只携带十二位 fingerprint preview，不含 prefix、executable 或 digest 字段，因此这项检查是确认而非发现。任何后续隐私修复都属于它自己的验收 candidate，需在 R6 rebase 之前完成。

### Runtime settings ownership

增加 `@deepseek-ai/dsh-science-runtime/with-settings` 入口：它以同一份 `Config` 提供同一个 service，并额外把现有 `profiles` 配置作为 `science-runtime` 用户设置 namespace 的 composition `base`。该 namespace 只包含 profile map；`dshHome`、执行 timeout 与 artifact diagnostic bounds 继续由 Cordis 配置，因为 R6 没有编辑它们的产品需求。根入口保持当前行为，永不读取 settings。

settings capability 是该入口声明的 Cordis injection，而不是 Runtime 在 load 时去探测的东西。Loader 并发创建兄弟 entries，因此“此刻是否存在 settings provider”回答的是哪个 module 先完成 import，而不是 composition 包含什么；挂载了该入口却没有 settings provider 的 deployment 会因未满足的 injection 停在 PENDING，而不是静默地只用 Cordis map 解析 profiles。

设置 schema 将空 profile map 视为刻意未配置状态。每个已声明 profile 仍使用 R2 safe-id grammar，至少包含 `pythonPrefix` 或 `rPrefix` 之一，并使用绝对路径。无效的已声明 profile 会让注册或设置写入失败。请求的 profile 缺失时仍在 provider I/O 与任何 Science event append 之前失败；不得回退到其他 profile 或发现的路径。

该入口使用 `applies: 'restart'` 注册 namespace，在 plugin load 时只捕获一次 resolved profile map，并且不 watch。Cordis entry configuration 继续作为低优先级 deployment base；用户文档可以通过现有 settings revision 与 mutation 规则覆盖或移除字段。成功写入只改变下一次 Host 启动；不能在 live Session 下替换环境。

`pythonPrefix` 与 `rPrefix` 在面向浏览器的 settings descriptor 中是 write-only secrets。Client 可以知道哪些 profile/language fields 已配置，以及是否存在 user override，但 settings response、forwarded event、diagnostic、snapshot 与 projection 都不得携带路径值。Host logs 与模型可见文字同样不含路径。

Web bundle 将与 base settings、subprocess、sandbox、attachment 与 Science Session services 一同挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，配置为 `profiles: {}`；排在 settings provider 之后的是 Cordis，而不是 entry order。在设置并重启完成前，这会把默认 Web failure 从“Runtime service missing”改成更可执行的“science profile missing”。CLI/headless bundles 不增加该 row；其 deployment overlay 继续拥有权威。

### Generic Details routing

为 `@deepseek-ai/dsh-client-ui-conversation` 增加名为 `conversation.details.view` 的 list slot。现有 tool-call body 成为内置 `tool` entry，保留当前 input/output rendering 与 `conversation.details.tool` child seat。Details shell 继续拥有 column geometry、close behavior、title chrome、collapsed 时保持 mounted 的 lifecycle 与 fallback behavior。

在 per-Session conversation store 中增加 `detailsView` id 及其选择 action。激活 tool row 时先选择 `tool` 与对应 call，再打开 column。session-header action owner 获得 `openDetailsView(id)` callback，用于选择已注册 entry 并打开同一 column。缺失、已移除或陈旧 id 回退到 `tool`；切换 Session 时继续沿用现有 AppFrame 行为关闭 column。

Details shell 从 slot registry 派生 labels 与 ordered entries，订阅 registry/locale changes，并且只渲染所选 entry。Registrations 均为 effects；卸载 domain entry 会移除其 label 与 body，并保留内置 tool entry 可用。任何 domain package 都不得占用顶层 `details` slot 或导入 Details shell implementation。

Title 文本是 shell 自行解析、而非纯粹读取 registry 的唯一例外：内置 `tool` entry 活跃时，shell 继续计算所选 call 自身的名称（回退到 selection 携带的 tool name，再回退到通用 label），与该 seat 存在之前完全一致，因为 per-session store 的 selection 无法表达 registration-time label；其余每个 entry 的 title 都是其注册的 label。若未来某个 entry 需要随 selection 实时变化的 title，应通过它自己的 selection state 表达该需求，而不是让 shell 获得更多内置认知。

### Science settings and Details product surface

把 `@deepseek-ai/dsh-client-ui-science` 从 R5 transcript rows 扩展为 Science settings page、Science header action 与 Science Details entry 的 owner。该 package 注册一个 id 为 `science` 的 `settings.section` entry、一个 `conversation.session.header.actions` entry，以及一个 id 为 `science` 的 `conversation.details.view` entry；同时保留 R5 的 `save_chart` 与 `publish_outcome` toolview registrations。

设置页通过 `ctx.settingsScope` 绑定 `science-runtime` namespace。它只编辑 `profiles.science.pythonPrefix` 与 `profiles.science.rPrefix`，因为已交付 preset 是当前唯一产品 Consumer，并固定 `profileId: science`。它展示 loading、namespace absent、unconfigured、configured、saving、stale revision、validation failure、saved-restart-required 与 reset-to-composition 状态。空 replacement inputs 是 no-op；显式 remove-user-profile action 会 unset `profiles.science`，在没有 composition base 时回到 unconfigured，否则重新显现该 base。其他 deployment profile ids 继续由文件/配置负责，R6 不把它们变成通用 profile manager。

浏览器永不回显已存 prefix。已配置字段显示中性的“configured”状态；替换时必须提供新的绝对路径，空字段不产生更改，显式 reset 只移除 user-layer `science` profile，使 composition base 能重新显现。Settings conflict 会先重新读取当前 descriptor，之后才允许再次写入。R6 不增加 browser filesystem picker、path discovery、prefix probing、package inventory 或 live apply button。

仅当当前 Session summary 指向内置 `science` preset 时，Science header action 才出现。激活它会打开 `science` Details entry。该 entry 读取 `science` Session projection，展示对 Client 安全的 environment summary、排序后的 run status/history、logical charts 及其最新验收版本，以及带 evidence references 的最新 Outcome。它复用 R5 attachment loading 展示 chart thumbnails，不创建另一个 projection、chart store、Outcome editor 或 attachment cache。

在首个 Science event 之前，Details entry 展示已选择 preset 与 unbound 状态。缺失 projection support、attachment unavailable、Runtime binding failed、无 runs、无 charts 与无 Outcome 各有不同的可访问文字。Standard 与自定义非 Science Sessions 不获得 Science header action，也不会自动打开 panel。UI 不把已配置 prefix 当成已验证；interpreter capability 只能来自 Host 重启并实际使用后形成的持久 environment binding。

### Checkpoints and executable sequence

**R6a — Runtime settings ownership.** 从 accepted R5 head 开始。增加 `with-settings` 入口及其 `science-runtime` namespace、刻意允许的 empty configuration、restart snapshot semantics、secret-path redaction、聚焦 Runtime/settings tests、覆盖两种 module import 顺序的 Loader composition 与当前 R2 Runtime 文档。在 R6b 开始前，独立 review 并验收准确 R6a head。此检查点不增加已交付 Web Runtime row 或 Client UI。

**R6b — Generic Details routing.** 从 accepted R6a head 开始。增加 `conversation.details.view`、内置 `tool` entry、per-Session selection、header-owner opening callback、stale-entry fallback、HMR disposal coverage 与当前 `ui-conversation` 文档。在 R6c 开始前，独立 review 并验收准确 R6b head。此检查点不得包含 Science-specific component。

**R6c — Science product composition and closure.** 从 accepted R6b head 开始。增加 Science settings page/header action/Details entry、default Web Runtime row、package metadata 与 invariants、assembled keyless browser coverage、accessibility checks、packed Web evidence、真实 Python/R Runtime acceptance、current documentation、把本 Note 改写为 implemented，以及 dated R6 evidence triplet。最终 review 覆盖准确 R5 base 到 R6c head；任何 source、privacy、browser、packed 或 real-runtime failure 都会停止收口。

每个检查点都记录准确 base/head identities，并在 SHA 变化后重新运行受影响证据。后续检查点不得静默修复已经验收的前序检查点；owner 必须把修复退回对应检查点、获得新的 accepted head，再 rebase 后续工作。

### Documentation and evidence

实施将更新 Runtime、`ui-conversation`、`ui-science`、settings、Science subsystem、package group 与 Web composition owners；它们的中文 pairs；受影响的 generated package/config/capability/module references；以及 browser snapshot expectations。它只在 R6 改变当前事实的位置更新仍 active 的 R2、R4 与已验收 R5 Agent Notes，不把 R6 rationale 复制到这些文件。

易变 SHA、commands、platform versions、真实 prefix identities、browser channels 与 pass/fail results 只写入 dated R6 evidence triplet。Source checks、built/packed Web evidence、真实 Python/R acceptance、Desktop、signing、notarization、publication 与 release 继续分别列出；R6 source 或 packed-Web success 不得提升未运行的层。

## Alternatives considered

**把 Runtime setup 留在 Cordis 文件，只增加只读 status page。** 否决，因为已交付 Web 应用仍会提供可选 Science preset，却没有产品设置路径。Settings seam 已支持 composition base、user override 与显式 restart timing，因此 R6 使用它，但不接管执行。

**由一个在 load 时检查 settings service 的 Runtime 入口绑定 namespace。** 否决，因为 Cordis Loader 并发创建兄弟 entries，该检查报告的是哪个 module 先完成 import，而不是 composition 声明了什么。只要 settings provider 的 module 落在后面，namespace 就不会注册，已存 profile 被静默忽略——而这正是用户为应用它而执行的那次重启——且 cordis.yml entry order 无法修复。声明式 injection 让 Cordis 为两者排序，并把缺失的 provider 变成可见的未满足依赖。

**Live 应用 prefix changes。** 否决，因为 live settings write 可能在 environment binding 与后续 run 之间改变 profile resolution，或要求迁移 exact-Session reservations 与 scratch ownership。Restart-only resolution 让每个 Host lifecycle 只使用一个 immutable Runtime configuration。

**发现或管理 Conda environments。** 否决，因为 discovery、create/clone/install/update/repair/delete、solver output、mutation locks、approval、rollback、quotas 与 cleanup 构成独立 capability。R6 只接受显式 existing prefixes。

**向浏览器返回已存 prefix paths。** 否决，因为 setup status 与 replacement 不需要披露绝对 Host 路径。Secret-path descriptors 保留 write 与 reset operations，同时阻止 browser snapshots 与 forwarded events 携带路径。

**让 `ui-science` 替换顶层 `details` slot。** 否决，因为这会移除 tool-call Details，并让一个 optional domain 拥有 generic column chrome。R6 在 conversation-owned routing slot 之后增加 domain entry。

**把 Science 渲染成另一个 center-column conversation tab。** 否决，因为 charts 与 Outcomes 已保留在 transcript 中，而 R6 需要一个可与 conversation 并列显示的紧凑 current-state surface。现有 Details column 提供这种关系，无需复制 transcript。

**把 R5 repair 并入 R6。** 否决，因为 R6 依赖已验收 R5 的持久 chart/Outcome 与 client-projection semantics。把 predecessor repair 混进 R6 会消除准确 accepted base，并使 R6 evidence 无法区分两个 inventory rows；在 R5 中发现的缺陷回到它自己的 candidate。

## Supersession and lifecycle

本 proposal 在未实现时不 supersede 当前决定。若被验收，它会修订 R2 configuration facts，加入 restart-only user-settings layer 与刻意 empty Web state；修订 R4/R5 composition facts，加入 default Web Runtime 与 Science Details consumers；并让其 execution、preset、chart、Outcome 与 privacy rationale 继续 active。本次 scoped Agent Note audit 未发现可 archive 的 implemented note、应 reject 的 obsolete proposal，或应删除的 rejected guardrail。

R6 验收后，本 triplet 移到 `implemented/feature`，`## Proposal` 改为现在时 `## Decision`，execution plans 改成已交付 verification facts，dated evidence triplet 绑定准确 final SHA 与每个 `NOT-RUN` layer。

## Acceptance criteria

- R6 只从 clean 的 R5 收口 head `16f5ce76abf8483c42bf02214cf15d82a2300b9c` 开始，其 implemented Note、dated evidence 与 browser-safe projection 必须一致；任何后续 R5 correction 先单独验收。其唯一一处这样的更正 `58aee8561ca665fc7056f2dc013e7012aafc4da5` 重新生成了 R5 遗留陈旧的 module graph，并在 R5 evidence 中记录该遗漏。
- Web bundle 挂载一个刻意未配置的、绑定 settings 的 Science Runtime；设置页可以通过 revision-checked writes 创建或替换固定 `science` profile，并显式 remove/reset 其 user override，每次成功更改都标注 restart required。
- 无论绑定 settings 的入口与 settings provider 谁先完成 import，都解析到同一个已存 profile，由逐个延迟各 module 的真实 Loader composition 证明；在没有 settings provider 时挂载它会停在 PENDING，而不是从 Cordis map 解析。
- Runtime configuration 在一个 Host lifecycle 内保持 immutable；empty 是显式 unconfigured state，malformed profiles 失败明确，缺失 `science` profile 在 provider I/O 之前失败，并且不会选择 alternate 或 discovered prefix。
- Settings reads/events、Session projections、snapshots、diagnostics、model-visible output 与 browser text 均不含绝对 prefix 与 executable paths。聚焦 negative tests 使用可识别 sentinel paths，只要它们跨过任一输出就失败。
- 通用 Details slot 保留 tool-call behavior，按 id 选择 domain entries，承受 locale updates，在 stale/HMR removal 后 fallback，证明 disposal，并且与现在一样在 Session 切换时关闭。
- 只有 built-in Science Sessions 展示 Science header action。Science Details entry 从已验收 projection 渲染 unbound、environment、run、chart、attachment failure 与 Outcome states，不增加另一个 state authority。
- 聚焦 Runtime/settings、`ui-conversation`、`ui-science`、ApiProxy/settings-redaction、Loader、application browser、accessibility 与 snapshot tests 在 owning changed-file coverage 下通过。`typecheck`、`build`、`hygiene`、`doc-sync`、`lint`、`git diff --check`、built/packed Web verification 与准确 final change-scope report 在记录的 head 上通过。
- 真实 Conda Python 与 R acceptance 在准确 final SHA 上使用 isolated、非 `/tmp`、mode-0700 DSH home，并分别报告 machine-readable PASS；fake-prefix tests 不能替代。Desktop、signing、notarization、publication、tag、push、PR 与 release 保持 `NOT-RUN`，除非另行授权并形成证据。
- Final independent review 获得准确 R5 base、R6 head、本 scope、command evidence、privacy sentinels 与 protected-worktree snapshot，复现关键 checks，并在 Note 移到 implemented 之前报告没有 unresolved high-severity finding。

## Risks

Empty Runtime row 让 service 在可用之前已经存在。R6 只在设置页明确点名缺失 `science` profile，且首次模型调用仍在 provider I/O 之前失败时接受此状态；任何 UI 都不得在持久 binding 报告 capability 之前把 Runtime 标成 ready。

Restart-only settings 可能让期待即时生效的用户意外。页面必须在 save 后持续显示 restart-required state，也不得刷新 live Session 并宣称新 prefix 已 active。

Write-only path fields 减少披露，却让用户无法目视确认已存绝对路径。R6 优先保护 Host 隐私，并提供 configured/user-override/reset state；未来 native Desktop picker 可以改善设置体验，而无需削弱 redaction。

右侧 Details column 变成共享 routed surface。通用检查点必须在 Science 注册 entry 之前独立保留 tool fallback 与 HMR behavior，否则 optional domain unload 可能使普通 tool inspection 失效。

真实 Python/R acceptance 只证明已配置 interpreters 与 Runtime lifecycle，不证明 plotting-library availability、scientific correctness、Desktop packaging、installer behavior、signing、notarization 或 release readiness。
