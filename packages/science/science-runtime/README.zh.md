# @deepseek-ai/dsh-science-runtime

[English](README.md) | 中文

`@deepseek-ai/dsh-science-runtime` 提供折叠的、host-local 的 Conda Science Runtime，用于持久化 environment、run 与 artifact 事实。它拥有 `ctx.scienceRuntime`、按 Session 隔离的私有 scratch、按 (session, language) 持久化的 Python/R kernel process、稳定 prefix 观测、精确 Session lease、终态结果分类、把 run 写出的文件自动捕获为带版本的 artifact，以及对已捕获 artifact 版本的纯元数据策展重标注能力。它不注册面向模型的工具、提示词、preset 或 UI。

## 组装

在 Host 加载 `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-science-session`、`@deepseek-ai/dsh-science-artifact-store`、`@deepseek-ai/dsh-subprocess-local`、`@deepseek-ai/dsh-sandbox-local` 和本包；在准入 Science Session fact 的组合中选择 `@deepseek-ai/dsh-science-session/invariant`。Runtime 要求 project artifact store、`host-local` subprocess provider 和报告 full enforcement 的 sandbox provider——不需要附件 provider:产物字节及其跨 session 索引都存放在 project artifact store 里，而非 session 级的附件存储。它的 `./invariant` 配套模块不重复事件关系，因为 Science Session invariant 负责 durable stream 校验。

包配置只命名现有的 absolute Conda prefix。它不调用 Conda，也不创建、克隆、更新、安装到、修复或删除 prefix。

```yaml
- name: '@deepseek-ai/dsh-science-runtime'
  config:
    dshHome: /absolute/test-owned/dsh-home
    timeoutMs: 120000
    kernelIdleTimeoutMs: 1800000
    kernelStartTimeoutMs: 30000
    profiles:
      analysis:
        pythonPrefix: /absolute/conda/python
        rPrefix: /absolute/conda/r
```

`profiles` 是由 `ScienceEnvironmentProfileId` 键控的 closed map。空 map 是合法的显式未配置状态；每个已声明的值仍至少有一个 absolute `pythonPrefix` 或 `rPrefix`。`timeoutMs` 默认是 120,000，且只接受 1 至 600,000 的 safe integer；它限定一次 `bindEnvironment` 或 `startRun` 操作，包括经过校验的 project artifact store blob 读取、全新 kernel 的 spawn/`READY` handshake，以及一次 run 等待的 kernel 协议交换。`kernelIdleTimeoutMs`（默认 1,800,000，即 30 分钟，与 Claude Science 对齐）与 `kernelStartTimeoutMs`（默认 30,000）分别只接受 60,000 至 86,400,000、1,000 至 600,000 的 safe integer；`chartExtractTimeoutMs`（默认 5,000；1 至 600,000）独立限定 run 后的图表交换，`chartLiveRunsRetained`（默认 4；1 至 64）限定 kernel 的 live-figure run 登记表。`packagesMaxEntries`（默认 2,000；1 至 20,000）与 `packagesMaxBytes`（默认 65,536；1,024 至 1,048,576）限定每个已观测 interpreter 保留的 package inventory，详见下方“操作”一节。`bindEnvironment` 与 `startRun` 都通过同一个 map 解析所请求的 profile id；不在 map 中的 id 会以 `ScienceRuntimeError('PROFILE_NOT_CONFIGURED', …)` 拒绝，其消息会指出缺失的前缀，并指向 Settings → Plugins → Science 卡片，而非内部 profile id 术语。`rasterCapture`（默认 `'declared'`，或 `'always'`）决定 `.png` 是否需要写入它的那次 run 自行声明才会被自动捕获，详见下方“自动捕获”一节。`captureMaxFileBytes`（默认 5 MiB；1 至 50 MiB）、`captureMaxFilesPerRun`（默认 50；1 至 1,000）与 `captureMaxArtifactVersionsPerSession`（默认 500；1 至 10,000）限定自动捕获，详见下方“自动捕获”一节。`inputMaxFilesPerRun`（默认 20；1 至 1,000）与 `inputMaxBytesPerRun`（默认 50 MiB；1 byte 至 1 GiB）限定一次 run 物化的 artifact input。成功的策展操作（`annotateArtifact`）从不读取 run 输出或 store blob 字节，因此没有属于自己的字节上限；缺少逻辑名时，它可能触发一次有界、安全的路径遍历，遍历保留的各次 run 目录，只为区分已保留但未捕获的栅格路径与未知名称——`annotateDiagnosticMaxRuns`（默认 20；1 至 1,000）限定该遍历检查最近多少次 run。`micromambaPath` 与 `installChannels` 各自可选，但必须一起配置；只配置其中一个会使配置解析失败。两者都未配置时，`installPackages`（见下方“操作”一节）会以 `ScienceRuntimeError('INSTALLER_NOT_CONFIGURED', …)` 拒绝，其他任何操作都不受影响，因为绑定与运行一个 environment 都不需要安装器。`micromambaPath` 是部署所用 micromamba 可执行文件的 absolute path。`installChannels` 是一个有序、非空的 `https://` conda channel URL 列表，每个 URL 都按固定字符 allowlist 校验（scheme 之后只允许字母、数字与 `._~/-`，不允许空白、控制字符或 shell 元字符），因为该值会未经转义地进入 `micromamba` argv。`installPackages` 会依次把每个 URL 当作一次完整、独立的 `micromamba install` 调用来尝试，一旦成功就停止；只有 `'failed'` 的一次尝试才会尝试下一个 URL，`'cancelled'`/`'timed-out'` 从不会，且任何一次调用都绝不会被赋予一个以上的 channel。`reconcileMaxSessions`（默认 500；1 至 100,000）限定一次 store ↔ session 对账读取该 project 自己多少条 session 日志。`reconcileRetryDelayMs`（默认 1,000；1 至 600,000）是一次完整、无 cursor、无错误的对账成功前，同一 project 两次尝试之间的最短间隔；只有后续 project 解析才触发重试，后台 timer 从不触发。两个字段都在下方“对账”一节说明。

<a id="settings-bound-entry"></a>

## 绑定 settings 的入口

`@deepseek-ai/dsh-science-runtime/with-settings` 以同一份 `Config` 提供同一个 service，并额外通过 restart-scoped `science-runtime` user-settings namespace 解析 `profiles`，该 namespace 只保存这张 map。Cordis `profiles` map 是它的 composition `base`。Runtime 在 load 时对解析后的 map 做一次快照，并且不 watch，因此一次成功 write 只影响下一次 Host start。`pythonPrefix` 与 `rPrefix` 在每份面向浏览器的 settings descriptor 上都是只写 secret。

该入口把 `settings` 声明在自己的 injection 中，这正是解析顺序得以固定的原因：Cordis 只在 settings provider 处于 ACTIVE 后才构造它。若某个 composition 挂载了它却没有 settings provider，它会因未满足的 injection 停在 PENDING。仅凭配置拥有自己 profile map 的 deployment 挂载根入口，根入口永不读取 settings。

两个入口提供的是同一个 `ctx.scienceRuntime` Cordis service，而该 service 只持有一个 provider：二者是互斥的替代关系，不会同时挂载。已发布的 Web bundle 默认在 Cordis entry id `science-runtime` 下挂载 `with-settings`；若某个 deployment 改为仅凭 Cordis 配置拥有自己的 profile map，应按 id 覆盖该行（与其它 bundle 行覆盖方式一致的 patch 替换），而不是 `insert` 第二个 Runtime 行——插入第二行会在 load 时抛出 `service "scienceRuntime" has been registered`。

## 操作

`bindEnvironment({ session, profileId, signal })` 要求精确的 live Science Session object 已含 durable `science/mode-bound` fact，观测所选 profile，并追加一个完整的 `science/environment-bound` 值。从其它 preset 重组进 `science` 的 blank session 会凭该 durable fact 满足要求，即使其冻结的 creation header 仍命名原 preset。静态缺失或不可用的 interpreter 会成为 `invalid` 值；取消、超时、prefix I/O 失败、partial confinement 或可写 root 重叠会拒绝且不追加 environment event。每个可用 interpreter 的 identity 还携带一份 package inventory：对完整观测结果排序并计算 digest 后的 name/version pair，再按 `packagesMaxEntries`/`packagesMaxBytes` 截留；超出任一上限都会截断保留列表并置位 `packagesTruncated`，而 digest 仍覆盖截断前的完整 inventory。若 package-inventory probe 未产生可解析的输出，整个 interpreter 观测会成为 `invalid`，与 version 和 UTF-8 probe 的诚实失败行为一致。session 一旦存在任何 run，`bindEnvironment` 自身就会拒绝再次调用(`ScienceRuntimeError('ENVIRONMENT_NOT_READY', …)`)；挡在本 Runtime 与"对一个已经跑过 run 的 session 表达一个更新的 environment revision"之间的正是这道 guard，而非 durable projection——只要当下没有 run 正在进行，Science Session 的 fold 早已能接纳一个取代更早 revision 的 `applied` revision。在已发布的产品中，`bindEnvironment` 自身从未被第二次调用：`installPackages`(见下方"操作"一节)通过一条完全独立、刻意不设 guard 的追加路径抵达更新的 environment revision，而不是解除这道 guard。

`startRun({ session, language, code, artifactInputs, editBaselines, toolCallId, requestHeaderSeq, signal })` 会在该 session 针对 `language` 的持久化 kernel 中执行 `code`：每个 (session, language) 对应一个长生命周期的 confined process，因此同一个 session 里 Python kernel 与 R kernel 可以同时存活。kernel 在第一次需要它的 run 上惰性启动，并在该语言之后的每次 run 之间保留 interpreter 的内存态——变量、import、定义，以及任何 inline `pip install`/`install.packages()` 的效果——直到它结束。每个 kernel 实例携带一个 `kernelEpoch`，一个跨两种语言严格单调的 session-local 计数器：两次 run 共享同一 epoch 就意味着共享了 kernel 的内存态；一次 run 的 epoch 与更早一次不同，就说明它面对的是一个从未见过那次 run 的全新 kernel。在发布 start 之前，Runtime 会对照实时 Science projection 解析每个 `artifactInputs` 条目——当该 session 自身的 projection 从未记录过所引用的 artifactId 时，会回退到所属 project 的 artifact store，因此一次 run 也可以引用同一 project 中另一个 session 产出的 artifact——通过 project artifact store 的校验 blob 读取路径读取不可变内容，并把精确字节写到 `<run>/inputs/<path>`——kernel driver 会把这同一目录以 `SCIENCE_INPUT_DIR` 发布给正在运行的进程；input path 必须是使用正斜线的相对文件路径，并拒绝逃逸、大小写折叠/Unicode、重复及文件与目录之间的碰撞。`SCIENCE_INPUT_DIR` 位于 `SCIENCE_ARTIFACT_DIR` 之外，因此 input 不会被自动捕获。完整有序映射会写入 `science/run-started`，并由 terminal fact 原样重复。缺失版本以 `INPUT_NOT_FOUND` 拒绝，无效或碰撞路径以 `INPUT_PATH_INVALID` 拒绝，任一已配置 input 上限以 `INPUT_TOO_LARGE` 拒绝；这些失败都发生在发布之前，不会留下已发布 run 或保留的未发布 run tree。`startRun` 把未改变的 `code` 写入同一私有 run directory，在交换开始前追加 `science/run-started`(携带执行它的 kernel 的 `kernelEpoch`)，并返回一个 `ScienceRunHandle`。kernel 当前目录保持为 run 输出目录；不可变的 Session 工作区不会成为 cwd，而是通过 `SCIENCE_WORKSPACE_DIR` 与 sandbox 内的绝对可读路径暴露。该 handle 只暴露 `runId`、`done` 和幂等的 `cancel()`；它不暴露 PID 或 Host scratch path。它解析出的 result 包含已提交的 terminal record、受限的运行期 stdout/stderr tail、精确 byte count 与截断事实。output text 永不进入 Science Session event。

kernel 是 Runtime 作为包资产随包发布的一个小驱动脚本——`kernel_python.py`(只用 Python 标准库)或 `kernel_r.R`(只用 base R，不用 `jsonlite`，与 R package-inventory probe 自身的 TSV 选择一致)——因为无法假定用户配置的 prefix 内含任何 notebook-kernel package，而 Runtime 也从不向 prefix 内安装东西。host 向 kernel 的 stdin 写入单行请求，并通过受管 POSIX `cat` 子进程转发其私有 scratch 中 FIFO 的单行响应，使空闲读取不占用 Host 文件系统 worker；一次 run 的 stdout/stderr 会写入请求所命名的 per-run 捕获文件，而不是 kernel 自身的 stdio。Python 在 file-descriptor 级别重定向一次 run 的输出(`os.dup2`)，因此 C 扩展与子进程的写入都会被正确归属到对应 run。R 只在 `sink()` 级别捕获：R 层面的 `print`/`cat`/`message` 输出会被正确归属，但 C 层面或子进程的写入会绕过 `sink()`，落入 kernel 自身长生命周期、有界的 stdout/stderr collector，永远不会归属回任何一次 run(见"已知限制")。当 driver 检测到自己无法完整恢复或归属某次 run 的输出捕获时，该 run 的 terminal event 会携带 `outputDegraded: true`；该 run 自身的 result 依然成立，只是其捕获的 tail 可能不完整。

kernel 会因一组封闭的原因之一结束，通常作为 `science/kernel-state`(`state: 'exited'`)追加：`idle`(自 kernel 上一次完成的 run 起 `kernelIdleTimeoutMs` 已过去，其间再无 run——在 run 进行中时被 disarm)、`session-end`(所属 Session detach——这次追加的目标是已经 detach 的内存中 log，因此永远不会被发布或 durable 持久化；replay 会改为从 `session/end-seed` 把该 kernel 恢复为 `interrupted`，见"已知限制")、`environment-rebound`(该 kernel 语言存在更新的 applied environment revision；该语言的下一次 run 会先结束这个过时的 kernel，再针对新 revision 启动一个全新的)、`run-escalation`(一次被中断的 run 使 kernel 自身状态无法证明，见下文)、`protocol`(driver 违反了 wire protocol——一个无法解析的 frame、response FIFO 的意外结束，或比 `kernelStartTimeoutMs` 更慢的 `READY` handshake)，以及 `crash`(kernel process 在未观察到协议违反的情况下无指令退出)。一次其 kernel 在运行中无指令死亡的 run，会以 `failureCode: 'KERNEL_DIED'` 结算。每个 run 的 terminal event，以及 `get_science_state`，都会命名执行它的 `kernelEpoch`，因此模型与 Reviewer 都能准确判断哪些 run 共享了内存。

取消或超时一次正在进行的 kernel execution 时，会先尝试中断、再考虑杀死：Runtime 向 kernel process 发送 `SIGINT`，并等待一个固定的宽限窗口，看 kernel 是否回应它捕获了这次中断。如果是，该 run 的 terminal 照常是 `cancelled`/`timed-out`，而 kernel 状态完好地继续运行——该语言的下一次 run 仍然能看到更早的每一个变量。如果 kernel 反而正常结束了这次 run(它自己的代码抢在中断之前完成，或者捕获并吞掉了中断)，或者没有在宽限窗口内回应，kernel 自身的状态就不再可信：Runtime 会在该 run 结算之后结束它(`run-escalation`)，该语言的下一次 run 会启动一个全新的 kernel。无论哪种情况，该 run 自身的 terminal status 都只由触发 abort 的原因决定(取消还是超时)，绝不会因 kernel 的命运而改写。

### 自动捕获

每个 run 的 terminal fact 一旦提交——无论 success、failed、timed-out 还是 cancelled——Runtime 会立即遍历该 run 私有的 `SCIENCE_ARTIFACT_DIR`，把每个合格文件按其相对该目录的路径（`plots/loss.png`、`summary.csv`）持久保存为对应逻辑 artifact 的当前版本。一个版本就是 project artifact store 自身的 per-artifact ordinal:内容一旦变化，无论出自哪一轮或哪次 run，都一律开出下一个版本(只有模型策展——下文的 `annotateArtifact`——才会就地取代某个版本)。store 行会先于其 `science/artifact-saved` 事件提交，因此事件的 `version`/`versionId` 与 store 自身的 ordinal 永远一致。`requestHeaderSeq` 仍是授权与溯源信息，而非版本身份。合格是指：路径任一 segment 都不是 dotfile 或 dot-directory，且小写扩展名属于固定 allowlist `.csv`、`.json`、`.md`、`.png`、`.txt`——这份文件格式 allowlist 与 Science 自身固定的 `ScienceArtifactMediaType` 集合(`dsh-science-session`)一致，不是 Loader 可配置项。在默认的 `rasterCapture: 'declared'` 策略下，一个原本合格的 `.png` 只有在同一次 run 的 `StartScienceRunRequest.rasterArtifacts` 中指名其相对捕获路径时才会被捕获；未声明的 `.png` 不会被捕获，其路径会出现在返回结果的 `skippedRasterPaths` 中(`'always'` 则无条件捕获每个合格的 `.png`，与其他扩展名一致)。每次 run 都拥有不同的私有输出目录，因此后续一次空 run 无法捕获上次未声明的文件；调用方必须重新运行写出该 PNG 的代码，并在新 run 的 `rasterArtifacts` 中声明同一路径。被捕获版本的 store 行带有 `content_origin: 'run-auto'`、完整的生产者溯源(`producerSessionId`/`producerRunId`/`producerToolCallId`/`producerRequestHeaderSeq`/`producerTurn`——授权 run 自身的 turn 号)与全量 64 位十六进制 `environmentFingerprint`(不是 preview);另有一条 `actor: 'capture'` 的 annotation 把标题设为文件的 basename。内容寻址使接纳具有幂等性——判定所用的权威是该逻辑名在 store 里的当前 head,不是本会话自身的本地历史(下文的人工编辑陈旧跳过判定同理;T1 的权威规则,读 `getLatestVersion`/`listVersions`,而非 session 事件上的 `origin`)——因此同一逻辑名的字节级相同重跑会被静默跳过，不会提交多余版本。若 store 行已提交而 Session 拒绝其 `science/artifact-saved` append,该行会立即在 store 自身的 `version_health` 上标记 `orphan`,而不是等待日后的对账。捕获的图片会按原样接纳:project artifact store 是一个纯粹的内容寻址字节存储，没有任何规范化步骤，因此存储的字节就是 run 写出的字节——科学证据——之后的读回也逐字节一致。

#### 图表可寻址性

通过 matplotlib `Figure.savefig()`/`pyplot.savefig()`、ggplot2 `ggsave()`，或在 `png()` 与 `dev.off()` 之间打印一张完整 ggplot 保存并捕获的 PNG，可以携带 `chart` 投影。kernel 保留导出时的图形快照与导出设置；预览和保存编辑都操作独立副本。R 保留绘图设备、DPI、尺寸和字体选项。artifact store 拥有原样 PNG 字节与普通元数据。基础绘图、视口组合、同一设备上的多张图以及捕获策略排除的路径仍保持普通 raster artifact 行为。

元素抽取与 hit-map 抽取相互独立。Matplotlib 在最终导出绘制期间记录位置，包含 `bbox_inches='tight'` 的裁剪变换；重复标注 id 对应各自的 artist。R 从构建后的图形中提取自动坐标轴标签，且只输出目录中已有 id 的命中范围。不支持的几何信息仍保留目录，但标记为 `hitmapStatus: 'unavailable'`。图表超时、协议错误、无效结果、adapter 错误或注册缺失均不阻止普通 PNG 捕获；`chartUnavailablePaths` 为诊断记录受影响路径，不进入模型输出。

每个 kernel 为最新的 `chartLiveRunsRetained` 个 run id 保留登记，并在抽取后清理更早的 run。同一次 run 内对同一相对路径重复保存会替换该路径的登记，因此抽取得到最后一次保存的 figure 与 export settings。

元素 id 在同一份目录内是唯一的：host codec 会拒绝携带两个同 id 元素的图表，因此每个适配器会在命中表抽取之前，按首次出现顺序为发生碰撞的 id(例如两个渲染文本相同的柱值标注)追加稳定的 `#N` 后缀。

series 或 annotation 的 id 会嵌入底层图形文本(series 标签、annotation 文本)的清洗、截断片段：每个适配器把控制字符——包括多行标签或标注中的换行——替换为空格，合并连续空白，并把结果截断到 60 字符，即使加上 axes 前缀与 `#N` 去重后缀，拼接后的 id 仍安全低于 host codec 的 200 字符上限。清洗后为空的片段(例如纯空白文本)使用位置占位符，如 `series[3]` 或 `annotation[2]`。元素自身的 `label` 字段从不清洗或截断——它保留用于展示的原始文本。

目录会保留全部 13 类元素，用于展示与精确模型引用。封闭的直接操作集合为 `set_title`、`set_subtitle`、`set_axis_label`、`set_legend_position`、`toggle_grid` 与 `set_font`；两个适配器都实现全部六项，预览也接受同一 codec。`font` 元素的 `current` 只包含 `family` 与 `size`，绝不枚举已安装字体族，也不携带截断元数据。`set_font` 通过绘图 runtime 检查请求的字体族；无法精确解析时返回 `font_not_found`，并且不改变图对象。matplotlib adapter 把已解析字体族与字号施加到图对象已有的 `Text` 对象，不修改全局 `rcParams`，并记录该 figure-wide 值供导出后抽取；ggplot2 adapter 则通过 plot theme 施加并重新抽取字体。

`set_subtitle` 修改 ggplot2 图的副标题或所选 matplotlib axes 的标题（`axes: null` 选择全部 axes），不修改主标题。即使两者的 axes 目标均为 null，主标题与副标题编辑仍为独立操作。全 axes 图例操作遍历全部所选 axes，包括无图例 axes 之后的 axes。图形副本在导出前把 DPI 变换归一到逻辑 DPI，避免显示设备像素比改变保存 PNG 的尺寸。

当一张 matplotlib 图既没有 `fig.suptitle()` 又只有一个 axes 时，会把该 axes 的标题抽取为 `kind: 'title'`(而非 `'subtitle'`)；存在 suptitle 或多个 axes 的图仍把 axes 标题保留为 `kind: 'subtitle'`。ggplot2 自身的标题始终是 `kind: 'title'`(ggplot2 没有与 matplotlib 单 axes 图 per-axes 标题对等的机制)，因此两个 runtime 在单 axes 图自身标题的 kind 上保持一致。

`set_legend_position` 把共享的 position 枚举映射到各自 runtime 自身的放置机制。matplotlib 把每个值原样传给 `Axes.legend(loc=...)`——这本就是它自己的枚举。ggplot2 4 的 `theme(legend.position = ...)` 只接受 `"right"`/`"left"`/`"top"`/`"bottom"`/`"inside"`/`"none"`——传入无法识别的字符串(原始的 matplotlib 角/边取值)会静默丢弃图例而不是报错，因此 ggplot2 adapter 不会把枚举原样传下去，而是确定性地映射：

| `position` | ggplot2 `theme()` |
|---|---|
| `best`、`right` | `legend.position = "right"`(ggplot2 没有与 `best` 对等的自动布局，取与 `right` 相同的外侧位置) |
| `upper left`、`upper right`、`lower left`、`lower right`、`center left`、`center right`、`upper center`、`lower center`、`center` | `legend.position = "inside"`，并设置 `legend.position.inside`/`legend.justification.inside` 为对应的归一化角/边/居中坐标(`x`、`y` 各取 `0`、`0.5` 或 `1`) |

其余任何 `position` 取值都是 codec 层面的 bug，而非合法的运行期输入，会使该操作失败(`stop("unknown_legend_position")`)而不是静默丢弃图例。抽取会把 inside 图例的位置读回为 `current: { position: 'inside', inside: [x, y], ... }`，因此直接编辑的新位置会回显进面板自身的展示。

##### 直接编辑

`applyChartEdit({ session, artifactId, version, ops, signal })` 把非空且受限的操作列表施加到确切的当前可寻址 PNG 版本。其来源是该产物最近的运行产出版本，而非另一次保存同名文件的运行。每次预览和保存都会复制来源版本保存的图对象，依次应用已提交操作和本次请求操作，再按原保存设置导出。若登记已经过期，运行时会在具有独立 home、状态目录和包安装目录的一次性解释器中，以确切的物化输入重新执行源码。恢复无法修改分析内核的变量、可变对象、模块或进程设置，也不产生科学运行或持久内核状态事件。依赖未声明内存对象或内核本地安装包的源码以 `CHART_NOT_ADDRESSABLE` 失败。无法重建已提交操作时，以 `CHART_NOT_ADDRESSABLE` 拒绝，而非静默丢掉版本中的部分修改。

现有 `timeoutMs` 约束整个预览或保存操作，包括冷启动和源码回放；`chartExtractTimeoutMs` 还约束每次图协议交互。操作被取消或达到 `timeoutMs` 时，以 `OPERATION_CANCELLED` 或 `OPERATION_TIMED_OUT` 拒绝，等待恢复进程清理后释放会话 lease。恢复失败保留分析内核；被中断的温图操作会退役其所属内核。参见[冷恢复隔离](../../../.agents/notes/implemented/bug-fix/2026-08-31-science-cold-replay-isolation.zh.md)。

每次成功保存都会向 project artifact store 追加一个不可变的 `content_origin: 'human-edit'` PNG 版本:`baseVersionId` 命名所请求版本(`baseExplicit: true`)，`environmentRevision`/`environmentFingerprint` 原样复制自该版本自身的 store 行(是赋值，不是重新校验的 fold check)，且不带任何 producer run/tool-call 字段。新版本在 store 的 `figure_state` 侧表里依次持有先前成功操作与本次成功的新操作。另有一次 `annotateVersion` 调用(`actor: 'human'`)把所请求版本的当前 title/caption 继承到新版本上；模型从不为这次元数据修改授权。部分目标无法解析时，会提交成功操作并报告带索引的 `failedOps`；没有任何操作成功解析的请求以 `CHART_ELEMENT_NOT_FOUND` 拒绝。`previewChartEdit` 不发布版本，也不改变保存的图对象，即使全部待提交操作都失败也如此。因此，放弃预览不会影响后续保存。标题与轴标签编辑保留既有文字样式。紧裁剪导出的外围边界可能随修改后的文字范围变化，但裁剪策略本身保持不变。参见[编辑隔离决策](../../../.agents/notes/implemented/bug-fix/2026-08-31-chart-edit-baseline-isolation.zh.md)。

确切版本与可寻址性失败分别以 `CHART_STALE_VERSION` 和 `CHART_NOT_ADDRESSABLE` 拒绝；格式错误或超过上限的操作以 `CHART_OP_INVALID` 拒绝。若源 run 的保留 scratch 已不可用，Runtime 无法恢复，也不会猜测。Consumer 向之后的模型回合公开直接编辑时，只给出操作名称、元素 target 与 `editCount`；标题文本、标签文本、图例位置与网格可见性不会进入净化后的 state 与 receipt 摘要。

产物身份归属于项目，不归属于会话:project artifact store 自身的 `UNIQUE(owningProjectId, logicalName)` 约束是"某逻辑名是新产物还是既有产物"这件事的唯一权威。若本会话自身的 fold 从未记录过某个逻辑名，一次懒加载、每次 walk 只查一遍的 `store.listArtifacts(projectId)` 查找若发现该项目内另一会话已经创建过它，仍会延续那个既有产物——这次查找漏掉的并发创建竞态，则通过重新解析出胜出者并向其追加版本来恢复，而不是让该文件失败。跨对话关系也可以通过精确版本的 `artifact_inputs` 显式声明；`edit_of`(`editBaselines`)仍然只针对本会话自身的实时 projection 解析。历史日志保留已记录的版本号。

每个 `editBaselines` 键都是经过校验的 capture-relative output path，值则命名一个精确且已提交的 artifact version。若该路径被捕获，新版本的 `baseVersionId` 会命名它(`baseExplicit: true`)：既有 logical name 照常推进自身 artifact，新 logical name 创建一个首版本带跨 artifact base 的新 artifact，而命名较旧版本会记录可见分支，不会静默改基线为 latest。缺失 baseline 会在发布前以 `ARTIFACT_NOT_FOUND` 拒绝。没有 baseline 的 output 保留普通捕获行为，内容未变化时仍会跳过。

`captureMaxFileBytes` 限定单个文件的可接纳大小(超限文件会被跳过并计数，绝不导致 run 失败)。`captureMaxFilesPerRun` 限定单次 run 尝试的合格文件数；超出的部分会被截断(不予尝试)并在返回的统计中标记。`captureMaxArtifactVersionsPerSession` 限定一个 session 通过自动捕获在所有 run 之间累积的 artifact 版本数；一旦达到，自动捕获会在该 run 剩余部分及此后的每个 run 中停止追加新版本并做出标记，直到未来的保留策略回收空间为止。捕获失败——无论是超限文件、触发上限，还是意外异常——都绝不会使已经提交了 terminal fact 的 run 失败。

`annotateArtifact({ session, logicalName, version, title, caption, toolCallId, requestHeaderSeq, signal })` 针对当前 live Science projection 解析所命名逻辑 artifact 的精确 `version`(省略时取其最新版本)，并追加一条新的 `version_annotations` 行(`actor: 'model'`，携带本次调用的 `sessionId`/`toolCallId`/`requestHeaderSeq`)记录传入的 `title`/`caption`——store 的内容寻址引用、producer 字段与 `created_at` 均不改变。策展是加在 session 已持有的内容之上的元数据，因此它绝不会推进读者所看到的版本号，且省略 `caption` 会清空此前的值(每次调用对两个字段都是权威的)。它从不读取或导入输出字节、从不从 project artifact store 读取 blob 字节，也从不公开 Host path。逻辑名不存在时，它会检查最近 `annotateDiagnosticMaxRuns` 个保留 run，对每个 run 先用与捕获相同的安全遍历检查 `SCIENCE_ARTIFACT_DIR` 下是否存在相同的合格 PNG，只有那里一无所获时，才检查该 run 自己 scratch 根目录下、`SCIENCE_ARTIFACT_DIR` 之外的同名 PNG。任一位置命中都只改变 `ARTIFACT_NOT_FOUND` 的消息：`SCIENCE_ARTIFACT_DIR` 下未声明的命中会提示调用方重新运行写出代码，并在 `raster_artifacts` 中声明该路径；scratch 根目录的命中会提示调用方重新运行写出代码、把文件保存到 `SCIENCE_ARTIFACT_DIR` 之下，并在 `raster_artifacts` 中声明它。两种情况下 store 与 projection 均保持不变，且因为输出目录按 run 隔离，后续一次空 run 都无法恢复该文件。除共享的 pre-publication 失败外，当 `logicalName` 或其命名的 `version` 在本 session 中不存在时拒绝并抛出 `ARTIFACT_NOT_FOUND`，当该 version 的 store 行属于直接人工样式编辑(`content_origin: 'human-edit'`)时拒绝并抛出 `ARTIFACT_NOT_CURATABLE`——策展它要么抹去直接编辑的判别标记，要么冒认该编辑从未拥有过的模型授权，因此其消息会引导调用方改用一次新的 run 或 viewer 自身的样式编辑器——当所给 `toolCallId` 已经为本会话 projection 已知的某个逻辑 artifact 的既往一次 annotation 授权过时，拒绝并抛出 `ARTIFACT_ANNOTATE_TOOL_CALL_REUSED`,该检查针对每个这类 artifact 在 store 中的当前 `version_annotations` 行(持久、可在重启后成立;被后续 annotation 取代的 `toolCallId` 在此检查下不再可见,本会话从未加载过的 artifact 也不在扫描范围内)。

`saveArtifactAs({ session, sourceVersionId, newLogicalName, signal })` 把一个已提交的 store version 复制进同一 project 里一个全新的逻辑 artifact：`createArtifact` 用一个全新的 `artifactId`、ordinal 从 1 开始、`baseVersionId` 显式命名源 version(`baseExplicit: true`)、源自身的 `contentOrigin`/`mediaType`/`environmentRevision`/`environmentFingerprint`/`figureState`(当源是携带它的 PNG 时)原样带过来，而 `producerSessionId` 设为当前调用会话——这是一个全新的 producer 事实，不是源自身 producer 的拷贝。源的字节通过 store 自身内容寻址的 `createArtifact` 调用重新准入(绝不是重新读取一个既有 blob 路径再重写)，该调用按摘要幂等，因此磁盘上不会有任何字节被重复写入。一条独立的 `actor: 'human'` annotation 把源当前的标题/caption 原样复制过来，与 `commitStyleEdit` 自身的标题继承 annotation 手法一致。`sourceVersionId` 可以命名该 project 的 store 持有的任意 version，不局限于本次调用会话自己的 projection 已经知道的那些——viewer 发起的复制读的权威是 store，不是 session 本地历史。这是一个 viewer 操作：没有 `toolCallId`/`requestHeaderSeq`，也绝不作为模型工具暴露。除共享的 pre-publication 失败外，当 `sourceVersionId` 在本会话所属 project 中不指向一个已提交 version 时拒绝并抛出 `ARTIFACT_VERSION_NOT_FOUND`，当 `newLogicalName` 在该 project 里已经被某个 artifact 占用时拒绝并抛出 `ARTIFACT_LOGICAL_NAME_CONFLICT`(把 store 自身的 `LOGICAL_NAME_CONFLICT` 翻译到 Runtime 的错误词汇上)。

### 对账

Runtime 在 `sessionProject` 解析出 project id 时触发一次有界的全 project store ↔ session 对账尝试，即运行 `dsh-science-artifact-store` 的 `reconcile.ts` 算法，把存储里的 version 行与该 project 的 `science/artifact-saved` 事件比对。它会在符合条件的尝试之间保留每个 project 的 session 收集 cursor 与 store 工作 cursor，因此每次截断调用都会推进，而不会重复固定前缀。只有完整事件收集以及无 cursor、无错误的存储对账运行成功，才会在当前 Host 生命周期内抑制该 project 的后续尝试。列举失败、日志不可读、目标事件格式错误、尚未完成的 session 或 store 工作、存储条目错误，以及被拒绝的存储调用都会让该 project 在 `reconcileRetryDelayMs` 之后被另一个 session 解析时继续符合重试条件；系统不会创建后台 timer 或重试循环。每次尝试都是 fire-and-forget：它从不阻塞或拖慢触发它的 Science 操作，每项失败都通过 `ctx.logger.warn` 记录并吞掉，不向外传播。没有挂载 `sessionPersistence` 服务的部署会直接跳过尝试，而不是把服务缺失当作错误。

`collectProjectArtifactEvents`（`reconcile-trigger.ts`）是本 Runtime 唯一一处读取自己存活 Session 之外的持久 session 日志的地方。它列出每一个 header `cwd` 解析后等于该 project 规范工作区路径的 session，通过 `SessionPersistence.inspect()` 逐个读取（读到的是原始、未解码的事件，绕过 `dsh-science-session` 的 codec，因此存储兜底重建所需的字段不会被面向更精简 live 数据的 codec 静默剥除），并按列举顺序把其中的 `science/artifact-saved` 事件按 `versionId` 归并（后写覆盖）。成功读取的逐 session 结果会跨调用累积；`reconcileMaxSessions` 限定每次调用的工作量，不可读或含格式错误事件的 session 会轮转到未访问尾部之后，不能阻止后续 session 被读取。列举失败或仍有待处理 session 都会让结果保持不完整；只有覆盖完整匹配集合后，才能从事件缺失推断 orphan。累积事件集、完整性标志与 store cursor 一并交给 `ScienceArtifactStore.reconcileProject`，该方法从不写 session 日志。不完整事件集会把没有事件的存储行分类为 `unverified`，保留其既有 orphan 标志，同时继续检查内容冲突、重建悬空事件、比较元数据并刷新 `missingContent`。事件收集变更或首次完整时，store 工作会在该累积集合上从头开始；后续有界调用继续推进 version 与悬空事件 cursor，直到没有剩余工作。七种情况的分类见该包的 README。

W2/W3 收窄:store 行(或 annotation)已经提交之后,`science/artifact-saved` 的追加若被 Session 拒绝,该 version 会立即在 `version_health` 上被标记 `orphan`,而不是等下一次对账才被发现。`capture.ts` 的自动捕获遍历在自己的追加点上早已这样做(见上文);`annotateArtifact`、`performChartEdit` 的人工编辑提交、以及 `saveArtifactAs` 共用同一个 `appendArtifactSavedOrMarkOrphan` helper,在各自的追加点上做同样的事。

`installPackages({ session, language, packages, signal })` 要求一对已配置的 `micromambaPath`/`installChannels`(否则以 `ScienceRuntimeError('INSTALLER_NOT_CONFIGURED', …)` 拒绝)，并要求 `language` 有一个已 applied 的 environment 且没有正在进行的 run(`ENVIRONMENT_NOT_READY`/`RUNTIME_BUSY`，与 `startRun` 自身的孤儿检查一致)。它会在一个以 prefix 自身为 root 的 `workspace-write` sandbox 策略下运行一次 direct、unconfined 的 `micromamba install --yes --no-rc --prefix <canonicalPrefix> --override-channels --channel <一个 URL> <packages>`——这是本 Runtime 中唯一一处授予 prefix 写权限而非要求其只读的 confinement 站点，因为安装正是唯一一种整个目的就是写入该 prefix 的操作。每个已配置的 channel URL 都会被依次当作一次完整、独立的调用来尝试；只有 `'failed'` 的一次尝试才会尝试下一个 URL，且任何一次调用都绝不会被赋予一个以上的 channel(一份 conda channel 列表意味着"搜索全部"，而非"依次回退"，把多个来源混进一次求解可能会从不同镜像里拉取包，拼出一个不一致的安装结果)。只有在成功时，Runtime 才会像 `bindEnvironment` 一样重新观测整个 profile，并追加一个全新的整值 `science/environment-bound` revision——如果重新观测发现能力失败就是 `invalid` revision，否则是 `applied`。这次调用本身从不重启任何 kernel:新 applied 的 revision 只会在该语言下一次 `startRun` 时生效，那次调用会发现 revision 不一致，先结束过时的 kernel(`environment-rebound`，见上文)再启动一个全新的——因此调用方应当预期内存中的 kernel 状态会在那次 run 才消失，而不是这次。一次失败、被取消或超时的安装会返回相应分类连同有界的 output tail，且不会追加任何 environment revision，durable projection 与每个存活 kernel 都会保持原样。

Runtime 对发布前的误用或能力失败以 `ScienceRuntimeError` 拒绝。start event 提交后，kernel 的 `ok`/`error`/`interrupted` 回应、一次无指令的 kernel 死亡、取消或超时都会各自追加一个匹配的 terminal event，按上文的中断语义分类(`success`；`failed` 并携带 `failureCode: 'EXECUTION_FAILED'`，对应 driver 报告的错误，或 `KERNEL_DIED`，对应无指令的 kernel 死亡；`timed-out`；或 `cancelled`)，紧接着就是上文的自动捕获遍历。still-live Session 不能提交 terminal fact，或意外 detached Session 使提交被禁止时，`done` 也会拒绝。

当某逻辑名在 store 里的当前 head 是直接人工编辑(`content_origin: 'human-edit'`)时，自动捕获还会忽略未声明、且字节仍与该 artifact 完整 store 历史中最近 run 产出祖先相同的文件。这样，私有 artifact 目录中编辑前遗留的陈旧文件不会在一次无关的后续 run 中回滚人工 version。若在 `editBaselines` 中指名该输出路径，就表示这次写入是有意的，因此模型编辑或显式回滚仍会正常提交。人工编辑 version 本身仍可作为 `artifactInputs` 与 `editBaselines` 来源。

## 限制与环境

每次 probe 和 kernel spawn 都使用 direct argv、空 subprocess environment base、固定 environment allowlist、owned cwd 和 full `workspace-write` confinement——与一次性进程所需的 confinement 完全相同，只是它现在贯穿 kernel 的整个生命周期，而不是每次 run 都重新来一遍。Python probe 使用 `-I -B -X utf8`(isolated mode：probe 从不安装任何东西)。Python kernel 去掉 `-I`，保留 `-B -u -X utf8`，并运行随包发布的 `kernel_python.py` driver；它的固定 environment allowlist 追加 `PYTHONUSERBASE=<kernel scratch dir>/pyuser`，在 spawn 时创建。去掉 isolated mode 正是让 inline `pip install` 能在同一个 kernel 内被 import 的原因：在 sandbox confinement 下 Conda prefix 是只读的，所以 pip 的安装会回退为 user-site install，而 `-I` 原本会把 user site-packages 排除在 `sys.path` 之外；`PYTHONUSERBASE` 则给这个回退提供了一个 kernel 自己拥有的、可写的目标，而不是环境默认位置。R 版本发现仅使用 `Rscript --version`；UTF-8 probe 使用 `Rscript --vanilla --encoding=UTF-8`；R kernel 在同样的 flag 下运行随包发布的 `kernel_r.R` driver，其固定 environment allowlist 追加了 `R_LIBS_USER=<kernel scratch dir>/rlibs`，并在 spawn 时创建——`install.packages()` 只有在目录已存在时才会把它加进 `.libPaths()`；而且只有 R_LIBS_USER，不同于普通的额外 library path，才是非交互式 `install.packages()` 在不带额外参数时的目标。Python 的 package-inventory probe 追加 `-m pip list --format=json`，报告 interpreter 自身所见；R 的 package-inventory probe 求值 `installed.packages()` 并以 TSV 打印 `Package`/`Version`，只使用 base R，因为无法保证 `jsonlite` 已安装。Runtime 拒绝与任何 writable root 重叠的 Conda prefix，且绝不把项目目录授予为 workspace。

`pyuser` 与 `rlibs` 都限定在各自确切的 kernel 实例上，而不是 session 或 environment：一次全新的 kernel——无论是 idle 重启、crash、interrupt escalation，还是 environment-rebound——都会在自己的 kernel-epoch scratch directory 下拿到一个全新的、空的 user-install base，因此一次 inline install 永远不会活过它所在的 kernel，也永远不会渗漏进之后绑定的 environment revision。

kernel execution 要求 POSIX(一个 FIFO、`SIGINT`，以及 `mkfifo` 和 `cat` 可执行文件)：仅限 darwin 与 linux。在 win32 上，`startRun` 会在任何 scratch 或 process 工作之前就以 `ScienceRuntimeError('KERNEL_UNSUPPORTED_PLATFORM', …)` 做 pre-publication 拒绝——这是一个诚实划定边界的单一执行模型，与 Claude Science 自身的平台覆盖范围一致(见"已知限制")。

私有 root 派生在 `DSH_HOME/science/v1/` 下，包含独占的 mode-0600 owner marker 与 mode-0700 directory，其中包括一个 `kernels/` 子树，容纳每个存活 kernel 自己的 scratch(其中就有它的 response FIFO)。只有独占 marker 创建成功的 operation 才取得 rollback ownership；materialization 失败时，会在校验 marker bytes 后删除该 operation 的精确 marker 与 Session root，而并发或既有 ownership 会被保留。live operation 保留精确的 Session object；相同 ID 的 successor 在较早 detached lifecycle 证明所有 owned tree——包括它拥有过的每一个 kernel——已静止前保持 quarantine。已接受的 run directory 会保留用于 state 和诊断；未发布的 probe directory 只有在静止后才移除。

## 验证

fake-prefix 测试覆盖 Python-only、R-only、shared 与 distinct prefix；严格配置，包括持久化 kernel 的 idle 与 spawn-to-READY 截止时限边界；稳定与漂移观测；无效 UTF-8 probe byte；两种语言的 package-inventory 解析、排序、entry/byte 上限截断与 probe 失败处理；scratch ownership；direct argv；空环境；output 上限；terminal 分类；取消；超时；detachment；同 ID quarantine；Loader 组合；以及 live/cold replay。kernel 相关机制拥有自己的一组测试，针对一个说 kernel wire protocol 的 fake driver，并通过真实的 subprocess-local 与 sandbox-local provider 组装：driver 资产解析(覆盖 source 与 built 两种执行方式)；kernel-process 的 handshake、连续多次 run、DONE 路由、READY 超时、协议乱码、run 中途的无指令退出、中断后存活、中断后升级、EXIT teardown 与 FIFO 清理；以及 kernel-set 的 epoch 分配与跨重启单调性、idle 过期与活动重置、Python 与 R kernel 共存、environment-rebound 重新 spawn、同 ID quarantine，以及 detach/dispose teardown。一套专门的自动捕获测试覆盖新文件、变更文件、字节相同的重跑(跳过)、超限文件、per-run 与 per-session 上限、dotfile/扩展名排除、对失败 run 的捕获、project artifact store 拒绝写入、一次不致命的内部捕获失败、不同会话各自创建同名产物（不同 artifactId、从 v1 开始、原产物 latest 不变），以及 Host 重启后的持久化读取。一个专门测试将 `bindingFingerprint` 与 package inventory 的独立性钉住：对同一静态 identity 重新绑定并观测到不同的 inventory 时，只会改变 `packagesSha256`，不会改变 `bindingFingerprint`。只用 lstat 的 prefix manifest 记录相对路径、类型、symlink target、mode、size、mtime/ctime nanoseconds 与 regular-file digest，且不使用 atime；前后 diff 为空才表示 prefix 未改变。`installPackages` 有自己的一套测试，覆盖 package-spec 校验、argv 构造(每次调用绝不超过一个 channel)、写权限 confinement 的分歧点、install-scratch 生命周期与 subprocess 分类；此外还有编排层面的覆盖，涵盖每一种 pre-publication 拒绝、单 channel 成功与失败、R-only 重新观测、一次无效的重新观测 revision、scratch 清理失败日志，以及整段式 channel 回退(第一个 channel 失败后尝试下一个、所有 channel 都失败、以及一次被取消的进行中尝试不会再尝试任何 channel)。

真实 Conda 验收独立且 opt-in。它绝不把 fake-prefix evidence 当作真实机器 evidence。

```sh
DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1 \
DSH_SCIENCE_RUNTIME_TEST_OWNED=1 \
DSH_SCIENCE_RUNTIME_DSH_HOME=/absolute/test-owned/dsh-home \
DSH_SCIENCE_RUNTIME_PYTHON_PREFIX=/absolute/conda/python \
DSH_SCIENCE_RUNTIME_R_PREFIX=/absolute/conda/r \
pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance
```

该命令分别将 Python、R 与跨语言共存独立报告为 `PASS`、`FAIL` 或 `NOT-RUN`；缺少 opt-in 输入时为 `NOT-RUN`。每个被选择的语言会校验 canonical prefix/executable/history identity、非 ASCII direct source/output、空环境行为、owned directory、full confinement、取消、超时、prefix-write denial、managed-tree 结算、未改变的 prefix manifest、同一 kernel 上两次 run 之间的状态持久化、kernel 在一次被中断的 run 后存活、kernel 在一次超时升级的 run 后被替换、environment rebind 启动一个全新 epoch、idle 过期(针对合法范围内最短的 `kernelIdleTimeoutMs`)启动一个全新 epoch，以及——仅 R——一个 bare 的顶层值自动打印到 stdout。另有一项与语言无关的检查，会绑定一个同时命名两个 interpreter 的 environment，确认 Python 与 R 的 kernel 以各自独立的 epoch 与各自独立的内存态共存。

## 模型体验

无。本 Runtime 为 `@deepseek-ai/dsh-tool-science` 提供非模型可见的操作，不注册任何提示词上下文。

#### KV Cache 影响

无；Runtime 不会组装或发送 provider request。

## 已知限制与暂缓事项

- **不管理 environment** — Runtime 消费显式指定的既有 prefix；不发现、创建、安装、更新、修复或删除 Conda environment。
- **只使用已有的本地 prefix** — observation 是 fingerprint，不是可复现环境锁；Runtime 从不管理 Conda package 或 environment。
- **仅 file-write confinement** — full sandbox enforcement 限制所述的 file write，但不宣称隔离 file read、network、syscall 或科学有效性。
- **仅 host-local execution** — remote subprocess provider 和 partial sandbox backend 会 fail closed，因为此实现拥有私有 Host scratch。
- **仅 POSIX 支持 kernel execution** — kernel spawn 与 response FIFO 要求 darwin 或 linux；`startRun` 会在 win32 上以 `KERNEL_UNSUPPORTED_PLATFORM` 做 pre-publication 拒绝，与 Claude Science 自身的平台覆盖范围(不提供原生 Windows build)一致。
- **R 的输出捕获仅在 sink 级别** — `sink()` 会把 R 层面的 `print`/`cat`/`message` 输出正确归属到对应 run，但 C 层面或子进程的写入会绕过它，落入 kernel 自身长生命周期、有界的 stdout/stderr collector，永远不会归属回任何一次 run。某次 run 的 terminal 上的 `outputDegraded: true` 标记了 driver 检测到自己无法完整恢复或归属该 run 捕获的情形。与 Python 的 `os.dup2` 重定向对齐的 fd 级别捕获是未来工作。
- **Host crash 之后不会对 kernel 的真实进程状态做对账** — replay 会为任何在 `session/end-seed` 时仍处于 `started` 的 kernel 派生出 `ScienceKernelInterrupted`，因此 durable log 与模型总会被告知：Host 重启之前的 kernel 不再运行；但本 Runtime 不会进一步核实或核对该 language interpreter 的真实操作系统进程在那次重启前后到底发生了什么。对账流程是未来工作。
- **`installPackages`没有预检的体积或磁盘空间检查，也没有粘性 channel 记忆** — 与桌面 provisioning 那条工作线的 `estimatedDownloadBytes`/`requiredFreeBytes` 及逐 source 健康元数据不同，本 Runtime 只在事后对已完成的 micromamba 调用做分类。若某部署配置的第一个 channel 当前不可达，每次调用都要承担那次失败尝试的延迟，因为没有任何机制记住上次是哪个 channel 成功的，每次调用都会从 `installChannels` 的第一项重新尝试。
- **`kernel_python.py` 必须持续在启动时把自己的 user site-packages 目录加进 `sys.path`** — Python 的 `site` 模块通常只在 interpreter 启动时做这件事一次，而且只有在那一刻该目录已经存在时才会做；pip 真正安装进去的那个嵌套叶子目录 `PYTHONUSERBASE/lib/pythonX.Y/site-packages`，要到某个 kernel 第一次 inline install 时才会被创建出来，那时已经错过了那次扫描。driver 用一次 `site.addsitedir(site.getusersitepackages())` 调用(在 `os.makedirs` 之后，于自身启动时执行)绕开了这个问题，也正是这一步真正让 inline `pip install` 能在同一个 kernel 内被 import——把它删掉会在不改动任何 flag 或环境变量的情况下，悄悄重新打开这个缺陷。
- **截断的 package inventory 无法回放为一个 environment** — digest 仍覆盖完整 inventory，因此截断是可检测的，但被截留的 name/version pair 列表不是可安装的规格说明。`bindingFingerprint` 从不纳入 package digest，因此调高或调低任一上限都不会改变 drift 检测。
- **会话中途安装的 package 在下一次绑定前不可见** — inventory 按每次 environment 绑定采集一次，而非按每次 run 采集；`condaHistorySha256` 已在那个时点捕捉 conda 层面的变更。
- **run 的 terminal 提交与其自动捕获遍历之间发生崩溃，会使该 run 的文件永久未被捕获** — 且没有自动重试。这与既有的 `science/run-started` 前/后 scratch 清理的不对称性相同，v1 接受此限制；未来的保留或对账流程是弥补它的接口。
- **遍历过程中(而非遍历之前)发生的自动捕获失败同样没有自动重试** — 无论是环境性故障(run 的 artifact 目录消失、权限或磁盘错误)还是本 Runtime 自身捕获逻辑中的缺陷，都会让该 run 的遍历就此停止而不导致 run 失败；该 run 自身的 terminal fact 与结果保持不变，且失败会被记录(环境性故障记为 `warn`，其他情况记为 `error`)而不是被静默吞掉，但该 run 中剩余的可捕获文件仍会保持未捕获状态，直到未来某个保留或对账流程以与上述崩溃场景相同的方式弥补这个缺口。
- **`editBaselines` 只依据该 session 自身的实时 projection 解析** — 与上文的 `artifactInputs` 不同，把同一 project 中另一个 session 产出的版本指名为 edit baseline 仍会以 `ARTIFACT_NOT_FOUND` 拒绝。要解除这一点，需要 `dsh-science-session` 的 strict fold 在 replay 时也接受一个无法在本地解析的跨 session `parent` 引用，这需要单独的跨会话血缘决策。
- **`annotate_artifact` 的 toolCallId 复用检查只覆盖本会话已加载的 artifact，且只看每个 version 的当前 annotation** — 不会扫描项目内的全部 artifact，且被后续 annotation 取代的 `toolCallId` 通过 store 的公开 API 已不再可见，因为该 API 不暴露逐 version 的 annotation 历史。要彻底解决需要 `dsh-science-artifact-store` 增加一个本包不会自行添加的 store 级查询(这是另一个包的地盘)。
- **R 组合图与基础绘图仅支持栅格编辑** — PNG 设备上只有一张完整 ggplot 时才可寻址；视口组合、多张图与基础 `plot()` 保留区域编辑。
- **重复保存只保留终态** — 一次 run 内多次把 matplotlib 或 ggplot2 图保存到同一路径时，抽取登记只保留最后一次导出的快照与设置。
- **无法复制的自定义图对象保持普通 PNG** — 快照失败不会破坏成功的保存，但图片无法直接编辑。冷恢复仍要求源码输入与绘图依赖可重现；运行时对象不持久化。
