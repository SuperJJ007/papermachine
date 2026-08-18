# Agent Note: DSH Science v0.1 R3 面向模型的 Science 工具（RC5）

Status: implemented

[English](2026-08-16-dsh-science-v01-r3-science-tools.md) | 中文

## 问题

已验收的 DSH Science v0.1 谱系已经包含官方 RC5 baseline、durable Science Session domain 与 host-local Science Runtime，但仍然没有 model-facing Consumer：没有 production package 绑定 `science/mode-bound`、把 durable environment 渲染为已记录的 request-context snapshot，或通过 tool pipeline 暴露 Python 与 R execution。因此 Runtime 没有已验收 caller，而未来 preset 也没有可组合的已验收 Science tool package 或 read-only filesystem entry。

Downstream Phase 3 candidate 为 request-context restoration、filesystem read-only subpath 与 Science tools 提供了有用 provenance，但其六个 commit 的 range 还包括 built-in preset，并且 whole-range hygiene 与 review 均失败。它的 snapshot 直接 assemble prompt pieces，而没有驱动真实 model request；其 Agent Note lifecycle 与已实现文件互相矛盾；其 documentation 也没有完整描述 request-context restoration。R3 在已验收 R2 tree 上重新推导所需行为，而不是采用该 candidate 或其 acceptance claims。

## 决策

R3 向已验收 R2 head `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` 依次增加三项结果：遵守 authoritative pre-step selection 且跨 pressure compaction 与 request retry 恢复 runtime context、`@deepseek-ai/dsh-tool-fs/read-only` plugin entry，以及新的 `@deepseek-ai/dsh-tool-science` Consumer。Review 修复增加 keyless runnable-example snapshot 并更新 test-only real application composition；已验收的修复候选为 `9a668331bd54c0d267d982927b2c5f77db6147bc`。R3 不增加 built-in Science preset 或任何 shipped Host composition row。

Session log 继续作为唯一 durable Science authority。`@deepseek-ai/dsh-tool-science` 追加一次性 mode binding，请求 `ctx.scienceRuntime` 追加 environment/run facts，replay `@deepseek-ai/dsh-science-session`，并注册 model-facing prompt 与 tool contributions。它绝不 spawn process、写入 run source、分类 termination、管理 Conda，或追加 Runtime-owned events。

### 精确身份

| 对象 | 身份 | R3 用途 |
|---|---|---|
| 官方 source baseline | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`，root version `0.1.0-rc.5` | 不可变的 upstream product baseline |
| 已验收 R2 head | `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` | 精确 R3 implementation base；包含已验收 R1、R2 decisions 与 evidence |
| Runtime-context provenance | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`，tests 在 `e5e8b29b435f67e0a5dde5e2132580966e78b27b` 修正 | `packages/core/agent-loop` 的只读 behavior/test input；不是 cherry-pick range |
| Read-only filesystem provenance | `omdsh-dev/dsh-science@8c7d5e01e3876b0c645f13f20ada8cf7add0c356` 与 loader correction `0073f6e0a11cd3444564cd1add5a252c70200b64` | 针对 RC5 重新推导的 read-only subpath 与 loader/package-resolution input |
| Science Consumer provenance | `omdsh-dev/dsh-science@27c96d8e8b2431814fe70a2e94fe8feeaf207b63` | Package behavior 与 test input；generated output 和失败的 Phase 3 acceptance 均排除 |
| 被拒绝的 whole-range candidate | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` | 仅作为 negative scope evidence；其 preset、review verdict 与 check results 不是 R3 input |
| 原始 R3 product candidate | `50d5b413e59a3425c8936717e2ee369341324774` | 在 R2 head 之上有三个线性 commit；因 review 修复而不再用于提升 |
| 被 review 的 closure head | `d1dc9f3d23cdb67f60d530db003a653fa4196194` | Review 失败；已被修复后的 candidate 取代，不再用于提升 |
| 已验收的修复后 R3 candidate | `9a668331bd54c0d267d982927b2c5f77db6147bc` | 位于 R2 head 之上六个线性 commit；通过最终 independent review 与 exact-SHA gates |

[R0 overlay inventory](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md#complete-overlay-inventory)负责 source identities 与 dependency order。[R1 Science Session decision](2026-08-15-dsh-science-v01-r1-science-session.md)负责 durable Science event 与 replay semantics。[R2 Science Runtime decision](2026-08-15-dsh-science-v01-r2-science-runtime.md)负责 environment/run operations、process lifecycle、confinement 与 real-runtime evidence meaning。[dated R3 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r3-science-tools.md)负责易变的 command output 与 platform facts。

### 范围

| 方向 | 区域 | R3 结果 |
|---|---|---|
| IN | `GEN-RUNTIME-CONTEXT` | 遵守最终 pre-step Enter batch、在 pressure compaction 后恢复 unchanged current context，并在 request-error replacement 后恢复精确的 first-request value；focused loop/resume/retry tests 与 owning architecture/package documentation |
| IN | `FS-READONLY` | 可独立 mount 的 `@deepseek-ai/dsh-tool-fs/read-only` function plugin，共享 root read configuration，且不注册 mutation tool |
| IN | `FS-READONLY-LOAD-FIX` | Source Loader 与 built-package resolution、精确 shared `Config` identity、package metadata 与 disposal |
| IN | `SCI-TOOLS` | `@deepseek-ai/dsh-tool-science`、其 required config、prompt/context rendering、三个 tools、invariant companion、package documentation、unit tests 与 real-composition coverage |
| IN | Mechanical integration | Package metadata、TypeScript paths/references、lockfile importer、package/capability/tool/model-experience registrations、generators、generated English catalogs 与 reviewed Chinese counterparts |
| IN | Closure evidence | 本 triplet 位于 `implemented/feature`，加上一个 dated R3 evidence triplet，记录 exact SHAs、commands、results、exceptions 与 `NOT-RUN` layers |
| OUT | Shipped composition | Built-in Science preset、CLI/Web preset manifests、shipped profile/bundle rows、default Runtime profile、real machine paths 与 provider credentials |
| OUT | 后续 Science product work | Charts、chart save tools、Outcome publication、persistent kernels、package/environment management、settings、sidebar、Details UI、client rendering 与 Desktop |
| OUT | Distribution 与 migration | RC6 或 latest-upstream migration、installer、signing、notarization、Authenticode、tag、npm publication、GitHub release 与 release-readiness claims |

原始 implementation slices 分别落在独立 commit 中：`1cf4ef0ddd`（runtime-context restoration）、`35ae6b5399`（filesystem read-only entry）与 `50d5b413e5`（Science Consumer）。Review 修复分别落在 `be46f69b6e`（review findings）与 `9a668331bd`（sanitization branch coverage）。R3 在最终 closure 后停止；[R4 built-in Science preset 及其 shipped CLI/Web composition](2026-08-16-dsh-science-v01-r4-science-preset.md) 是下一个 slice。

### Generic runtime-context restoration

`ReactLoopAgent.preStep()` 只 assemble prompt 一次、渲染 dynamic contexts，并通过 `RuntimeContextProjection` project 一个 candidate。只有 projection 表明当前值已存在时，它才会在 dispatch waterfall 之前保留 exact fallback。最终 Enter batch 提交后，`step()` 仅在没有 owned value 留存时恢复这个此前已接受的 fallback，随后冻结实际 retained 的精确值供 retry 使用。它不会在 request loop 内再次 project assembly。

Loop 不会在 request retry 期间再次调用 `systemPrompt.assemble()`：retry 属于同一个 step assembly，而 `PromptAssembly` 中的每个 `AssembledContext` 都已经持有 resolved text。当新投影出的 candidate 被移除、改写，或后面又追加了另一个 owned runtime-context message 时，最终 `agent/pre-step` Enter batch 具有权威性。如果 assembly 已与 retained context 一致，fallback 就是此前已接受的精确 message，用来在首次请求前修复 pressure compaction。随后 loop 会捕获该请求实际 retained 的精确 owned value；只有 request-error handling 将其移除时，retry 才恢复这个 captured value。

`packages/core/agent-loop/tests/request-error.spec.ts` 中的 focused tests 针对 candidate removal、exact rewrite、最终 owned Enter-batch value、首次 attempt 前的 pressure replacement、retry 前的 replacement、unchanged retry 不追加 duplicate、clearing-marker restoration 与 unrelated replacement，断言实际 request messages 与 durable surface events。既有 `loop.spec.ts` suite 继续覆盖 malformed retained state 与 cross-turn clearing。`docs/architecture.md` 与 agent-loop README 描述了该 ordering。

该 generic correction 扩展当前 runtime-context mechanism；它不 supersede Web runtime-context decision，也不向 Core 增加 Science types。

### Read-only filesystem entry

`@deepseek-ai/dsh-tool-fs/read-only` 是既有 package 中的第二个 function-plugin entry，拥有自己的 `name`、`inject` 与 `apply`。两个 entry 都从新增的 `src/config.ts` import `Config` 与 shared 的 `resolveReadCaps()`，因此 `read-only` re-export 的是精确的 root `Config` schema value，而不是副本。Root entry 保留 `read`、conditional `read_image`、`write` 与 `edit`；read-only entry 只注册 `read` 与 conditional `read_image`。

Conditional `read_image` 可以通过单独组合的 attachment service 持久化 immutable attachment bytes。该 side effect 不授予 filesystem write 或 edit operations。禁止 attachment persistence 的 deployment 应省略该 service；R3 不改变 attachment contract。

Package 附带一个 `tsdown.config.ts`，把 `index`、`invariant` 与 `read-only` 打包为三个扁平的 `lib/` entry（workspace 默认只打包 `index`/`invariant`/`startup`）；`package.json` 的 exports/files 与 `tsconfig.base.json` 的 source-plane path map 显式命名该 subpath，与 `tool-subagent-control/list-agents` 的既有先例一致。`packages/fs/tool-fs/tests/read-only-loader-composition.spec.ts` 通过 Loader 启动一个命名了 bare subpath specifier 的真实 `cordis.yml`，证明 root 与 read-only roster 能够独立解析，也证明一个无关的 subpath specifier 会被拒绝，而不是悄悄解析到另一个 entry。`packages/fs/tool-fs/tests/built-lib.e2e.ts` 在 plain Node 下从 built `lib/` import 已发布的 root 与 subpath，证明 `Config` object identity 在构建后依然共享、read-only roster 不包含 `write`/`edit`，并且共享的 resolver 在 read-only entry 上同样会拒绝 invalid config。Disposal 只会移除被 disposed mount 所拥有的 registrations，因为 Cordis effect 会把每次 `ctx.tools.register(...)` 调用限定在其所属的 plugin fiber 上。

该 entry 保留在既有 npm package 中，因为其 dependencies、configuration、implementation 与 release lifecycle 继续和完整 filesystem tool package 共享。只有后续 ownership change 才需要独立 package。

### Science Consumer package

#### Configuration 与 eligibility

`@deepseek-ai/dsh-tool-science` 是一个 function plugin，拥有 required `profileId`、`modeRevision` 与 `stateHistoryLimit` configuration。`profileId` 使用 durable Science safe-ID grammar（`^[A-Za-z0-9][A-Za-z0-9._-]*$`，≤128 个字符），并选择一个 Runtime allowlist entry。`modeRevision` 会被 trim、非空，且不超过 128 个字符，并持久化到 `ScienceModeRef`。`stateHistoryLimit` 是正 safe integer，分别限制 `get_science_state` 返回的最近 run 与 chart-version 集合。这三个值都没有 default，也不来自 environment discovery；本包不命名 shipped production identity 或 history policy。

Plugin 只 statically inject `tools` 与 `systemPrompt`。它在最早需要 Runtime 的 operation 上——首次使用绑定，以及每次 `run_python`/`run_r` 调用——用 `ctx.get('scienceRuntime')` 读取 optional Host-owned Runtime。Model-facing operations 需要 exact initiating Agent，且其 Session 当前必须解析为 `science` preset identity（`isScienceSession`，即 `@deepseek-ai/dsh-agent-presets` 的 `resolveSessionPreset`，以创建 header 为基础、被之后任意一条 `agent-preset/selected` 事件覆盖——为何仅凭 header 不够，参见 [Science 产品缺陷 Agent Note](../bug-fix/2026-08-18-science-mode-product-gaps.md)）。没有 Agent 与 turn signal 的 diagnostic prompt assembly 不执行 Host I/O，并原样 delegate。

#### 首个 model request

在首个真实 Science prompt assembly 上，Consumer replay Session。如果 mode 缺失，它会在 `step/start`、`request/header` 或任何 tool call 之前追加 `science/mode-bound`——durable 的 Science Session applicability 规则独立强制这一顺序，因为该追加发生在 `preStep()` 的 `systemPrompt.assemble()` 调用内部，严格早于 `turn()` 追加 `step/start`。既有 mode 的 revision 必须等于 configured `modeRevision`；不匹配会在 request construction 前拒绝 assembly。

如果没有 durable environment，Consumer 使用 exact live Session、configured branded profile 与 assembly signal 调用 `ctx.scienceRuntime.bindEnvironment()`。Durable `invalid` environment 仍是 model-visible value，而 missing Runtime、cancellation、timeout、Host I/O failure 或 confinement failure 会拒绝 assembly。匹配的 resumed Session 不执行 automatic rebind——仅靠 replay 就能确认两项事实均已成立。

Context providers 会在 assembly waterfall 完成前 render。Binding 之后，Consumer 再次 replay projection，并在 existing assembly 内替换命名为 `science:environment` 的 entry（读取 waterfall 自身 `next()` 的结果，而不是假设 object identity 不变），然后精确 delegate 一次。Agent loop 随后在 request header 前把当前 context 记录为 `user/message`，使 first request——以及同一步骤内每次被恢复的 retry——都能从 Session log 重建。

#### Context 与 tool contracts

一个静态的 `tool:science` prompt section 陈述每次 Python 或 R call 都会启动 fresh process、reusable state 属于 `SCIENCE_STATE_DIR` 或 `SCIENCE_ARTIFACT_DIR`、terminal program failure 是需要检查的 result，而 infrastructure failure 表示不存在 trustworthy run result。Deterministic 的 `science:environment` dynamic context 只包含 durable mode/environment identity 与 status、interpreter capability/version 与一段截断后的 fingerprint、file-based state rule，以及 bounded latest-run summary。它省略 Runtime-owned free-text reason、source、stdout、stderr、credentials 与 Host path/identity field，并在 Science mode 之外或没有 initiating Agent 时渲染为 `''`。

Package 准确注册 `get_science_state`、`run_python` 与 `run_r`，使用 generic render intent，且没有 editor locations。`get_science_state` 不接受 arguments，并返回 sanitized、bounded view：model-safe environment facts、最近的 runs 与 chart versions、遗漏计数、outcome、总量 metrics、mode 与最后一条 Science event sequence。Host prefix、executable path 与 identity、Conda history hash、environment reason 与 run `failureMessage` 都不会进入 tool result；chart 与 Outcome prose 仍是 model-authored durable content。每个 run tool 只接受一个 non-empty `code` string，要求最新的 `request/header` 与 exact tool call ID，把 tool cancellation signal 转发给 `startRun()`，并 await returned handle。

Durably committed 的 `success`、`failed`、`timed-out` 或 `cancelled` terminal state 是 structured tool value，包含 bounded stdout/stderr text、exact byte counts 与 truncation facts——其 `ScienceRunValue` type 用 `InferValue<typeof runOutputSchema>` 推导而不是手动重复声明，因此在 `exactOptionalPropertyTypes` 下 schema 与 runtime 形状不会发生漂移。Start publication 前的 failure、未证明的 process-tree quiescence 或 terminal-commit failure 会成为 error tool result。Consumer 不重复验证 typed same-process Runtime values；config、durable events、tool JSON 与 service availability 继续作为 validation points。

Package 的 invariant companion 注册带说明的 empty installer，因为 Science Session invariant 负责 durable event/projection relationship，而 Consumer 不拥有额外 authoritative mutable relation。`packages/science/tool-science/tests/tool-science.spec.ts` 证明 registration 与 disposal 都是 effect：dispose plugin fiber 会移除三个 tool schema 以及 `science:environment` context entry。

### 验证与关闭

R3 source evidence 包括 filesystem 与 Science source 的 focused per-file 100% coverage，以及每条 changed Core restoration path；evidence record 披露了仍不在 focused suite 内的 pre-existing Core `runMaintenance` guard。Adjacent package tests、typecheck、build、package invariants、documentation synchronization、lint、whitespace、publint、NodeNext consumer types、受影响的 hygiene checks 与 plain-Node built-root/subpath smokes 覆盖其余已验收 surfaces。

Product-visible Consumer 有两项 assembled check。`packages/science/tool-science/tests/loader-composition.spec.ts` 通过 Loader 启动 test-only `cordis.yml`，其中包含真实 agent loop、Session store、Science Session invariant、Science Runtime、persistence、tool pipeline 与 Consumer；它覆盖 first-request context、durable ordering、三个 schemas、run execution、无重复 binding 的 resume，以及 Standard-session negative path。Keyless runnable example `examples/headless-agent/science-tools.cordis.snapshot.yml` 还会 snapshot 实际 model-facing guidance、Science schemas、sanitized bounded state result、structured durable run terminal、rendered `run_python` tool result，以及 durable Science event ordering。同一条真实 Loader request 只暴露 `@deepseek-ai/dsh-tool-fs/read-only` 的 filesystem `read` roster，不暴露 `write` 或 `edit`。

针对明确授权的既有 Conda prefixes 的真实 Python 与 R Consumer acceptance，在 R3 中保持 `NOT-RUN`，与本 keyless evidence 分开追踪。Preset、Web、browser、Desktop、provider credentials、signing、publication 与 release 保持 `NOT-RUN`。[dated R3 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r3-science-tools.md)把每项 result 与 exception 绑定到已验收的 candidate SHA。

### Supersession 与 lifecycle

R3 不 supersede R1 Science Session 或 R2 Science Runtime decisions。它消费二者的 public responsibilities，并用 model-facing Consumer 完成当前 Runtime capability。Generic runtime-context correction 扩展 active system-prompt/session mechanism，read-only entry 扩展当前 filesystem package；它们的既有 decisions 继续独立有用并保持 active。

Downstream Phase 3 proposal 是 excluded lineage 的 provenance，未被复制到 active tree。[R4 built-in Science preset 及其 shipped CLI/Web composition](2026-08-16-dsh-science-v01-r4-science-preset.md) 完成了这个随产品交付的应用层；在 product UI、artifact 与 release layers 通过各自 decision/evidence 之前，project documentation 不得宣称 Science Mode 已 release-ready。

## 考虑过的替代方案

**采用或 cherry-pick downstream Phase 3 range。** 拒绝，因为该 range 混合 generic prerequisites、Science tools、preset、generated outputs、hygiene failure 与未验收的 request-path snapshot。Provenance SHAs 标识需要重新评估的 behavior，而不是 RC5 谱系的 patch 或 evidence boundary。

**在 R3 中包含 built-in Science preset。** 拒绝，因为 preset composition 拥有独立 CLI/Web、resolver、snapshot、browser 与 packed-Web responsibilities。先验收 Consumer，使下一 slice 成为 bounded composition decision，并防止 preset fixture 代替 Consumer 的 request-path evidence。

**把 read-only filesystem entry 推迟到 preset。** 拒绝，因为已批准的 Science capability roster 要求在没有 mutation 的情况下 discovery 与 reading，而 generic package/loading behavior 需要独立 ownership 与 built evidence。在 R3 中完成它，避免了后续 composition slice 携带 generic filesystem implementation。

**创建单独的 read-only filesystem npm package。** 拒绝，因为 configuration、read implementation、dependencies 与 release lifecycle 继续共享。第二个 package 会在无法独立演进的情况下重复 ownership。

**在 Session creation 时绑定 environment 或 hard-inject Runtime。** 拒绝，因为 Session-start notification 无法 await 或 veto Host I/O，unused Sessions 不应 probe Conda，而且 Runtime 继续是 Host deployment configuration，而不是 agent-scope package dependency。首个真实 asynchronous assembly 拥有 exact Agent 与 cancellation signal，并可在 request 前失败。

**在 retry 前重新 assemble system prompt。** 拒绝，因为 retries 属于同一个 step assembly，而 repeated assembly 可能重复 Host effects。Loop 会捕获 first request 的 exact owned snapshot，并只在 retry handling 移除它时恢复该值。

## 后果

R3 让 Science 拥有了第一个 model-facing Consumer，且没有引入 downstream history 或 shipped composition。现在每个 science-preset request 都携带一份可从 durable 记录重建的 mode/environment snapshot，`run_python`/`run_r` 通过普通 tool pipeline 到达 `ctx.scienceRuntime`，并得到 bounded、structured 的 results。代价是 generic agent loop 需要保存 authoritative first-request selection 与 exact retry restoration 的额外状态，并且每个 Consumer composition 都必须显式配置 state-history policy。Runtime 仍然没有 shipped composition：preset、Web 与 Desktop slices 仍然开放。

First-use prompt assembly 会执行一次 Host environment observation，可能延迟 first request；request-path tests 覆盖了 cancellation、timeout、static invalid bindings、operational failure 与 matching-resume behavior，确保 slow/failed observation 不会发布 partial model contract。Retry restoration 会冻结 first request 实际 retained 的 exact owned snapshot；未来如果某个 feature 需要在 retries 之间引入新的 Host facts，就需要一个单独的 logged update operation，而不是重新运行 assembly。拥有独立 Cordis plugin identity 的 package subpath 不如单独 package 直观；shared schema identity、package documentation、source Loader coverage 与 built import coverage 让该 topology 保持显式，并以 `tool-subagent-control/list-agents` 先例作为后续拆分的命名范式。

真实 Python 与 R Consumer acceptance、preset composition、Web/Desktop application layers 与 release readiness，仍然与 R0 overlay inventory 中记录的一致：留给后续 slices 的开放工作。
