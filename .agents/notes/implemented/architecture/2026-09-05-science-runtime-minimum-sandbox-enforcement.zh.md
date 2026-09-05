# Agent Note: `science-runtime` 只通过显式配置接受部分沙箱强制执行，并记录实际接受的级别

Status: implemented

[English](2026-09-05-science-runtime-minimum-sandbox-enforcement.md) | 中文

## 问题

`science-runtime` 的 `confineWithFullEnforcement` 要求每一次沙箱 confinement——持久化 kernel spawn 与 interpreter probe 均不例外——都报告 `enforcement: 'full'`,否则以 `CONFINEMENT_UNAVAILABLE` 拒绝。`dsh-sandbox-windows-acl`(`dsh-sandbox-local` 的 win32 一级)如实报告 `enforcement: 'partial'`:其写入限制 ACL 令牌无法弥合两个已验证的缺口(Everyone 可写的外部对象仍可达;NTFS 硬链接把工作区授权别名到外部文件对象——见 `packages/sandbox/sandbox-windows-acl/README.zh.md` 的"已验证边界"一节)。写死的 `'full'` 要求让每个 win32 部署永久无法运行 Science,即便某位维护者已经明确判定这一较弱边界可以接受,也没有办法接受它([issue #14](https://github.com/SuperJJ007/papermachine/issues/14))。

## 决定

**由一个经过校验的 `Config` 字段决定接受下限,而非常量。** `science-runtime` 的 `Config` 新增 `minimumEnforcement?: 'full' | 'partial'`,默认 `'full'`,像其他字段一样在加载时校验(`assertMinimumEnforcement`)——遵循"插件中不写死可调项"原则:随部署而变的接受策略是显式配置选择,而不是悄悄写进 confinement 函数里的放宽。

**`confineWithFullEnforcement` 泛化为 `confineWithEnforcement`,把所配置的下限作为参数传入。** `meetsMinimumEnforcement(reported, minimum)` 在 `minimum === 'partial'`(任一报告级别都满足)或 `reported === 'full'` 时返回真;`minimum === 'full'` 只接受 `'full'`。`CONFINEMENT_UNAVAILABLE` 仍然覆盖低于下限的一切情形,但抛出的消息现在会同时点出两个级别(`` `Science requires at least ${minimumEnforcement} sandbox enforcement; the sandbox reported ${confined.enforcement}` ``),而不再无论实际配置为何都只重复"full"。sandbox provider 本身未被触碰:`dsh-sandbox-windows-acl` 继续如实报告 `'partial'`;接受与否的决定完全留在 Science 这一侧。

**两个 confinement 调用点都从 `ScienceRuntime` 的已解析配置中读取所配置的下限。** `environment.ts` 的 `confineProbe`(interpreter probe,经由 `bindEnvironment` 到达)传入 `services.minimumEnforcement`,该值本身由 `index.ts` 的 `ResolvedConfig` 贯穿而来。`execution.ts` 的 `confineInterpreterArgv`(持久化 kernel spawn)接受一个 `minimumEnforcement` 参数,但其唯一调用方 `kernel-process.ts` 不在本次改动范围内(并行分支 `feat/win32-kernel-transport` 拥有 kernel spawn 在 win32 上的接线),因此该参数对这一个调用方默认取 `'full'`——kernel spawn 尚未端到端地遵循一个配置为 `'partial'` 的下限。这是一个真实且已记录的缺口(`science-runtime/README.zh.md` 的"已知限制"一节),而不是声称已完成全链路接线:今天在显式配置 `'partial'` 的情况下,probe 已经可以在 win32 上运行;而持久化 kernel spawn 在 win32 上依旧无法运行,这与 `minimumEnforcement` 无关——因为 `environment.ts` 的 `prepareObservation` 与 `index.ts` 的 `startRun` 都会在到达 confinement 之前就无条件拒绝 `process.platform === 'win32'`([PR #17](https://github.com/SuperJJ007/papermachine/pull/17) 的 `KERNEL_UNSUPPORTED_PLATFORM`)——本次改动不触碰、也不放宽这道平台闸门。[win32 scratch 隐私与 probe 排序的 Agent Note](../bug-fix/2026-09-06-win32-scratch-privacy-and-probe-ordering.zh.md)补上了本段所说的 kernel-spawn `minimumEnforcement` 缺口:`KernelSetOptions`/`KernelProcessOptions` 现在把所配置的值转发进 kernel-spawn confinement,与 `confineProbe` 早已把它转发进 probe confinement 的方式一致。

**实际被接受的强制执行级别会记录在每一条 environment binding 上,持久化保存。** `ScienceEnvironmentBinding`(`dsh-science-session`)新增 `sandboxEnforcement?: 'full' | 'partial'`,以内联字符串字面量的方式镜像 `dsh-sandbox` 的 `SandboxEnforcement` 类型,而不是让 `dsh-science-session` 依赖那个包——一个领域事件包没有理由仅为镜像一个字面量就依赖沙箱 seam 的类型。`index.ts` 的 `environmentBinding()` 构造函数从实际运行过 probe 的那个已声明 interpreter 取值(`observed.python?.enforcement ?? observed.r?.enforcement`)——两种语言的 probe 都在同一个 provider、同一个所配置下限下 confine,因此任一存在的值都是这次会话的实际级别;只有当每个已声明的 interpreter 都在到达 confinement 之前就静态检查失败时,该字段才缺席。该字段经由 `dsh-science-session` 的 client-safe projection(`ScienceClientEnvironmentBinding.sandboxEnforcement`)未经脱敏地透传——它不携带任何 Host 路径或密钥——因此 provenance 展示的是 Science 实际接受了什么,而不仅是它要求了什么。`packages/client/ui-science` 的 `EnvironmentSection` 已经通过 `JSON.stringify` 渲染整个 client binding,因此无需改动 UI 代码;该字段一旦存在就会自动出现。

**这次编解码新增是一次兼容的领域负载改动,不是 `SESSION_FORMAT_VERSION` 的一次提升。** [会话日志版本机制的 Agent Note](2026-08-10-session-log-version-mechanism.zh.md) 把那个整数保留给 header/envelope/surface 机制层面的改动,以及无法识别的**事件类型**(`ignorable` 标记);它并不管控给一个已知事件类型自身的负载 schema 新增一个可选字段。`dsh-science-session` 的 `environmentSchema`(`.strict()`)新增 `sandboxEnforcement: z.enum(['full', 'partial']).optional()`,完全遵循 `codec.ts` 里 `artifactSchema` 的 `seenAt`/`createdAt` 已有先例:该字段存在之前写入的每条日志上都缺席,而一个 `.strict()` schema 在发布前阶段可以安全地做这种加法式扩展。出于同样的理由,`SCIENCE_EVENT_VERSION`(该包自身单一共享的负载版本字面量,自引入以来从未提升过)同样保持不变——提升它会让所有既有 Science 事件失效,而不仅仅是 `science/environment-bound`。

## 考虑过的替代方案

**构建一个完全强制执行的 Windows 沙箱后端,而不是接受部分强制执行。** 已否决:`dsh-sandbox-windows-acl` 的两个缺口是 Windows 受限令牌本身固有的,不是实现上偷工减料——Everyone 必须留在 restricting SID 列表中,早期 DLL 初始化与 CNG 才能正常工作;而 NTFS 硬链接别名的是文件**对象**而非路径,因此一个打在硬链接(指向 pnpm store 中某文件)上的工作区 ACE 必然会波及外部别名。要弥合任一缺口都需要一种根本不同的 confinement 机制(基于名称而非基于令牌的检查),远超本次改动范围,维护者也未要求这么做。

**对任何受支持平台的沙箱所报告的强制执行级别一律静默接受,不设配置下限。** 已否决:这正是维护者在 issue #14 中所排除的"静默放宽"——一个沙箱退化为报告 `'partial'` 的平台部署(未来的某个后端、一次配置错误的环境)会在毫无记录、运营者也毫无拒绝机会的情况下,开始接受一个更弱的边界。一个默认为 `'full'` 且经过校验的显式 `Config` 字段,让接受与否变成主动选择且有名可查。

**把 `sandboxEnforcement` 记录成 client projection 上的顶层字段,而不是嵌套在 `environment` 之下。** 已否决:强制执行级别是某一条 profile binding 自身 confinement 结果的属性,不是整个会话的属性(同一会话可以跨 revision 重新绑定 profile),因此它应当和 `python`/`r`/`status` 一样,附着在它们本就所在的那同一个 `ScienceEnvironmentBinding`/`ScienceClientEnvironmentBinding` 值上,而不是作为一个新的同级概念。

**在本次改动中就把 `minimumEnforcement` 一路贯穿进 `kernel-process.ts` 的 confinement 调用。** 已否决:`kernel-process.ts`、driver 资产,以及 `startRun`/`prepareObservation` 中的 win32 拒绝逻辑属于 `feat/win32-kernel-transport` 的地盘;在此改动这些代码会与同一批代码行上的并行工作产生合并冲突。`confineInterpreterArgv` 的可选参数(默认取 `'full'`)让唯一现有的调用方保持不改动即可编译,同时让该函数已经就绪,等待那个分支拥有接线权之后传入真实的值。

## 后果

一次 interpreter probe(`bindEnvironment`,先于任何 kernel spawn)现在只有在部署方在 `science-runtime` 配置中显式设置 `minimumEnforcement: 'partial'` 时,才会在沙箱报告 `'partial'` 的情况下成功;默认值(`'full'`)在未显式覆盖的每一处都保持今天的行为不变。`apps/desktop` 的 `runtime-overlay.ts` 只对 `platform: 'win32-x64'` 在生成的 `cordis.yml` overlay 中设置 `minimumEnforcement: partial`;每个 darwin 目标都省略该字段,保持 `'full'` 默认值。这次 overlay 改动目前在真实桌面启动路径上是不生效的:`apps/desktop/src/main.ts` 的 `openInitialSurface()` 早已在 onboarding 开始之前就拒绝 win32 启动(`unsupportedPlatformErrorPage()`,来自 PR #17),因此本次改动写入的 overlay 设置尚未被一个真实的 win32 用户触达——它是启用 Windows 分析能力中配置层的那一半,先于 kernel-transport 与平台闸门相关工作落地而准备好,后者落地之后这项 overlay 设置才会端到端生效。

Science 写入的每一条 environment binding,只要至少有一个已声明的 interpreter 的 probe 到达过 confinement,现在都会携带 `sandboxEnforcement`,可从会话日志与 client projection 的 `EnvironmentSection` 中读到(沿用既有的 `JSON.stringify` 渲染,无需新增 UI)。`packages/science/tool-science/README.md`/`README.zh.md` 说明了接受级别是可配置且会被记录的。`science-runtime/README.md`/`README.zh.md` 记录了新的 `Config` 字段、被记录的字段,并链接到 `dsh-sandbox-windows-acl` 的边界清单以说明 `'partial'` 究竟意味着什么;新增的一条"已知限制"如实说明了 kernel-spawn confinement 尚未完成的缺口,而不是暗示已经完成端到端接线。

覆盖范围:`environment.spec.ts` 中与 `config.spec.ts` 等价的用例覆盖了 `minimumEnforcement` 的默认值、两个合法取值,以及一个失败即报错的非法值;`execution.spec.ts` 新增了一套 `confineWithEnforcement` 矩阵(full/full 接受、partial/full 拒绝并点出两个级别、partial/partial 接受、full/partial 接受、不可用则无论下限如何都拒绝)以及一对 `confineInterpreterArgv` 用例(默认取 full、接受调用方传入的下限);`dsh-science-session` 的 `projection.spec.ts` 与 `fold.spec.ts` 覆盖了该字段的存在、缺席与解码往返。
