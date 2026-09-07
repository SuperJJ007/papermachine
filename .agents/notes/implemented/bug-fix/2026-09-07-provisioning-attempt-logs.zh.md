# Agent Note: 每次 provisioning 源尝试都把完整的 micromamba 日志写到磁盘

Status: implemented

[English](2026-09-07-provisioning-attempt-logs.md) | 中文

## Problem

2026-09-07 对 issue #22 的一次调查（一次 TUNA 源安装无声失败，几秒后换 USTC 源成功，全程没有可见的错误）发现 `DesktopEnvironmentProvisioner.provision`（`apps/desktop/src/provisioning.ts`）在后面某个源成功之后，从来不会把前面失败源的输出保留下来。遍历 `declaration.sources` 的 `for` 循环把每一行 `onLine` 都记进同一个 `logRingBuffer` 数组，上限 200 行，且在整次调用中跨所有源尝试共用；只有当**全部**源都失败时，循环才会截取最后 200 行并作为 `recentLogs` 附到抛出的 Error 的 message 里。一个源失败后紧跟一个成功的源，会走成功路径上的 `break`，于是"全部失败"这个唯一会读取 `logRingBuffer` 的分支根本不会执行——失败源的那些行就此消失：不写文件、不进 UI、也不进遥测（`environment.install-failed` 的载荷本来就只限定 `sourceId`/`phase`/`cancelled`，这是设计使然）。即便是全部失败的场景，共享的环形缓冲区也意味着只有*最后*一个源的行能在跨全部尝试的 200 行总量里幸存——本次调查真正要追的那条诊断信息（`remove_all` 的 MAX_PATH 错误）在循环结束前，早就被下一个源自己那几百行 `create` 输出挤出去了。

onboarding 的"一键复制报错诊断"按钮（`onboarding.ts` 的 `startConfirmed` catch）和 `environment.install-failed` 遥测事件都继承了这个缺口：两者对中间某个源的失败都拿不出任何东西可展示，只能应对整次 `provision()` 调用彻底失败的情况，而且即使那样也只有最后一个源被截断的尾部。

## Decision

`provision()` 现在为每次源尝试——不论成功还是失败——单独开一个 append-only 日志文件：`<root>/logs/provision-<source.id>-<timestamp>.log`（`<root>` 就是既有的 provisioner root，即 `desktopEnvironmentsRoot(dshHome)`；`logs` 目录以 `mkdir 0o700` 创建，每个文件 `0o600`）。新增的 `AttemptLog` 类会在每一行 `onLine` 到达时就把它 append 进该文件——是真正的逐次 `appendFile` 调用，不是先在内存里攒起来最后一次性写入——所以进程或整机崩溃在尝试进行到一半时，磁盘上仍然留得下 `micromamba create` 已经产生的部分；写入通过一个内部 promise 链串行化，因此各自独立流式输出的 stdout/stderr 行落盘时仍保持原有顺序。每次尝试自己的最后一行是一个状态标记：成功时是 `exit ok`，失败时是导致失败的 Error 的第一行 message（是*抛出的*那个错误，例如 `desktop provisioning: process stopped (1)`——概述子进程为什么停止，追加在子进程自己通过 `onLine` 已经流式输出的诊断文本之后）。`provision()` 在开始本轮尝试之前，会先清掉 `logs/` 下上一轮调用遗留的全部 `provision-*.log` 文件，所以这个目录里始终只有当前这轮调用的日志，而不会随着一次次重装/重试无限堆积每个源一个文件；日志写入失败（比如磁盘满）会被吞掉而不是让 provisioning 事务失败——这份日志是一个诊断侧信道，从来不是决定成败的东西。搭建这条侧信道本身也遵循同样的标准：创建 `logs/` 或清理其中残留条目失败时（该路径已被一个普通文件占用、某个匹配 `provision-*.log` 的残留条目本身是目录、或在 win32 上是 `rm` 的 `force` 选项不会重试的锁定残留文件）同样会被吞掉，整次调用会在本轮禁用 attempt 日志的情况下继续——不记录、不写入任何 attempt 日志路径，全部失败时的 `attemptLogs`/重试消息里也不会出现。

`recentLogs`（附在全部失败的 Error 上，形状不变）现在改为每次尝试重新构建，而不是在整个循环里共用同一个缓冲区，所以它现在只记录*最后一次*尝试的行——不会再被更早的源的输出悄悄混进来或挤掉。同一个 Error 还新增了 `attemptLogs: ProvisioningAttemptLog[]`（`{ sourceId, path }`，每个被尝试过的源一条，按尝试顺序排列，不论该次是否失败），并且 `recentLogs` 和新的 `attemptLogs` 路径都被折叠进 Error 自身的 `message` 文本里——而不是留作裸的对象属性——因为 Electron 的 `ipcMain.handle` 会在一个抛出的 Error 到达渲染进程之前，剥掉除 `message` 之外的全部属性（这是 `electron.d.ts` 里 `handle` 自己文档化的行为），这也是本次改动之前 `recentLogs` 就已经必须走这条路的同一个原因。

中间某个源的失败也会在重试消息里自报家门：下一个源的 `phase: 'solving'`"Retrying via …"进度更新会追加上一次失败的首行错误信息和它那份日志的完整路径（双语，见 `buildRetryMessage`）。这一行是瞬时的——同一个进度节点的下一次更新，也就是被重试源自己的第一行 `installing`，几乎立刻就会把它覆盖掉——所以它只是把用户能在面板上看到"运行为什么继续往下走"的那一刻稍微拉长了一点；那次失败尝试完整输出的持久面是 `buildRetryMessage` 报出的日志文件,而不是进度面板。

Attempt 日志文件按决定不脱敏、不设大小上限。`<dshHome>/logs/host.log`（`apps/desktop/README.md`）经由一个会对形似凭据的值脱敏、且自身设了 5 MiB 加两次轮转上限的写入器,是因为它会随整个安装过程持续累积;而一份 attempt 日志的生命周期只有一次 `provision()` 调用——`clearStaleAttemptLogs` 会在*下一次*调用开始时就把它删掉——所以驱动 host log 设上限和脱敏的那两个理由(累积、暴露窗口)在这里都不成立。`buildProvisioningEnv` 既有的白名单(`SECRET_ENV_PATTERN`,匹配 `KEY`/`SECRET`/`TOKEN`/`PASSWORD`)已经在任何一行有机会进日志之前,就把凭据类命名的环境变量挡在了子进程自己的环境之外;没有进一步的机制去扫描 micromamba 自己 stdout 里可能嵌着的凭据。

保留策略是只留本轮:`clearStaleAttemptLogs` 会在当前这轮调用的第一次尝试开始之前,先删掉上一轮 `provision()` 调用在 `logs/` 下遗留的全部 `provision-*.log` 文件,所以任意时刻最多只存在一轮调用份量的 attempt 日志。一个文件只能活到*下一次* `provision()` 调用开始为止,包括用户在从诊断报告里复制了路径之后又去重试同一次安装所触发的那一次;报告自己的 `完整日志文件 · Full log files` 标题和 `clearStaleAttemptLogs` 自己的 JSDoc 现在都写明了这一点。

`onboarding.ts` 的诊断报告按钮从捕获到的错误文本里解析出 `Attempt logs:` 标记（`attemptLogPaths`，对已经收到的 message 字符串做一个小正则匹配——鉴于上面 Electron 剥属性的事实，这份 message 文本是这条路径清单实际到达渲染进程时携带的信息），并在现有的 `- Error:` 围栏代码块之后追加一段 `完整日志文件（下次点击"下载并安装"会被清空，请先复制或另存）· Full log files (cleared the next time you click Download and install — copy or save them first):`，列出每一条路径（当这次失败确实带了任何日志路径的时候；一次容量或平台不支持之类、根本没走到源循环的失败不会带任何路径，报告在那种情况下不变）。`stripIpcErrorPrefix`（为 issue #22 的 app-local-CRT 修复而加）未受影响——这一段是在那次剥离已经发生*之后*追加的，不是之前。

## Alternatives considered

- **保留单一的 200 行环形缓冲区，只把它改成按每次尝试重置。** 已否决：这仍然会在下一个源开始运行的一瞬间丢弃前一个失败尝试的完整输出，事后磁盘上什么都查不到——而这正是 issue #22 需要补上的那个真正的缺口。环形缓冲区能约束的是"内联进 Error message 里能展示多少"；一旦运行已经越过那次失败往下走，它回答不了"那次失败的尝试到底打印了什么"。
- **只在整次 `provision()` 调用失败时才落盘，用保留下来的每次尝试的行。** 已否决：这就是今天的行为加一个更大的缓冲区，而 issue #22 自己的场景（TUNA 失败、USTC 成功）恰恰是整次运行*不会*整体失败的情况——失败源的日志依然永远不会被写下来。
- **把 `attemptLogs` 作为结构化数据经 IPC 传递（一个带类型的桥接返回值），而不是折进 Error 的 message 文本里。** 本次改动未采用：`provision()`/`provisionCustom()` 今天是 `Promise<void>`，一次失败本来就是以一个抛出的 Error 跨越 IPC，而 Electron 只保留它的 `message` 这一个属性——把桥接的成功/失败契约重塑成一个可辨别的结果类型，是一个比本次修复范围更大、需要单独评审的改动；而 message 文本这条信道本身已经能用（既有的 `recentLogs` 内嵌方式已经证明了这一点）。
- **改经 `ProvisioningProgress` 传递 attempt 日志路径清单，而不是折进 Error 的 message 文本里。** 未采用：`ProvisioningProgress`（`provisioning.ts`）本身就是一个已经在本功能范围之内的结构化信道——`main.ts` 会把每次更新的全部字段原样转发给渲染进程——但 `onboarding.ts` 的诊断报告是在整次运行*结束之后*、从捕获到的 Error 构建出来的，改从进度更新里读这份路径清单,就需要渲染进程跨每一次更新自行累积,而不是在失败那一刻一次性读取;message 文本这条信道已经不需要任何渲染进程侧状态就能做到这件事。
- **无限期保留日志文件，不清理上一轮的。** 已否决：一个被反复重装或重试的环境会无限堆积每次调用每个源一份文件、没有上限；在每次 `provision()` 调用开始时清理，恰好只保留当前这一轮的证据,不需要再额外引入第二套保留策略去推理。

## Deferred

以下几项来自同一次调查，明确不在本次改动范围内，延到 0.1.2：

- 清理失败尝试在磁盘上残留的包缓存/prefix，超出每次循环开头已有的 `rm(prefix, { recursive: true, force: true })` 之外的部分。
- 每次重试前重新检查剩余磁盘空间（目前只在第一次尝试前检查一次）。
- 遇到 `CRYPT_E_REVOCATION_OFFLINE` 失败时追加 `--ssl-no-revoke` 重试。
- 探测并把 win32 主机的系统代理配置（Electron 的 `resolveProxy`）转发进 `buildProvisioningEnv`——目前只转发进程环境变量里的 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`。

## Consequences

`provisioning.spec.ts` 新增一个 `per-attempt logs on disk` 测试组：一个 TUNA 失败、USTC 成功的场景断言两次尝试的日志文件都存在,失败尝试的文件包含其流式诊断行且以抛出错误的首行结尾,成功尝试的文件以 `exit ok` 结尾,且随后的"Retrying via"进度消息同时包含失败的首行信息和失败尝试的日志路径;一个全部源失败的场景断言抛出的 Error 的 `attemptLogs` 按顺序列出全部三个源,`recentLogs` 只包含最后一次尝试的行,且每次尝试自己的日志文件都独立保有该次尝试自己的行;一个用注入的确定性时钟驱动的两次调用场景断言,第二次 `provision()` 调用开始后,`logs/` 目录下只剩第二次调用的文件;一个 `logs/` 路径已被一个普通文件占用的场景断言 `provision()` 仍然成功、不往那个文件里写任何东西,而同一设置下的全部失败变体断言抛出的 Error 上完全没有 `attemptLogs` 属性。`onboarding.spec.ts` 新增覆盖:当错误文本带有 attempt 日志时,诊断报告会追加一段 `完整日志文件（下次点击"下载并安装"会被清空，请先复制或另存）· Full log files (cleared the next time you click Download and install — copy or save them first):`;不带时则不追加。`apps/desktop/tests` 全部通过;`tsc -b tsconfig.host.json` 和 `oxlint` 在每个改动文件上都干净通过。

真机验证(一次真实的 win32 TUNA→USTC 换源,在真实硬件上确认日志文件和重试消息)按本任务自身的缩量范围,延到本项目下一轮三端实机;本次改动只用注入的 `ProcessRunner`(与 `provisioning.spec.ts` 里其它每个换源场景已经使用的同一种测试替身约定)和 macOS 本机的静态检查做了验证,没有做一次真实的 `micromamba create` 调用。
