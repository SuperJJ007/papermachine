# Agent Note: Viewer 写入的 turn 归属与数据加载提示词指引

Status: implemented

[English](2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.md) | 中文

## Problem

在两个 turn 之间的空闲间隙里点了一次另存(Turn 9 已经结束、Turn 10 还没发出)，这次另存在轨迹里显示在 Turn 9 下面，直到用户发出 Turn 10，副本才悄悄挪到 Turn 10 下面。`saveArtifactAs` 与 `performChartEdit` 的人工编辑提交都是没有授权工具调用的 viewer 操作，因此严格 Science fold 的 turn/step 归属逻辑(只认打开中的 `run_python`/`run_r`/`annotate_artifact` 调用)从来不适用于它们，`ScienceClientArtifactVersion.turn` 始终是 `undefined`。客户端 `science-trace-model.ts` 用 `lastTurn` 填补这个空缺，而 `lastTurn` 在每次渲染时都从当前已加载的 conversation 重新推算——于是一个在最新 turn 出现之前就已经创建的版本，一旦那个 turn 出现，就会漂移到它头上。

另外，实机上还暴露出两处独立的提示词缺口。Science persona 告诉模型用 `read`/`glob`/`grep` 读取、搜索、检查工作区，但没有一条规则指引表格数据改走 kernel；被要求读一份 CSV 的列名时，模型用了 Glob+Read，没有留下任何 DataFrame，于是后续要求对"刚加载的 df"做计算时，还得重新读一遍文件。另一处，`annotate_artifact` 的描述预设了被命名的 artifact 已经存在("你的代码已经产出的某个 artifact")；被要求给一个不存在的 `nothing.png` 加标题时，模型从没调用这个工具去核实，而是直接创建了一个替代文件，而不是报告根本没有这个名字的东西。

## Decision

**`saveArtifactAs` 与 `performChartEdit` 的人工编辑提交都会把 `producerTurn` 设为会话最后一次已开始的 turn，在方法被调用时读取一次。** 两者都已经从 `assertSession` 持有一份 `ScienceProjection`；`projection.trace.turns.at(-1)?.turn` 在任何后续 `await`(kernel 重放、库往返)之前就被取走，因此在空闲间隙里创建的版本会保留调用那一刻正当前的 turn，绝不会变成 store 写入提交那一刻恰好最新的 turn。库早就在 `VersionRecord`/`VersionProducerInput` 上建模了 `producerTurn`(capture.ts 的 run-auto 路径早就从授权 run 自身的 `tool/call` turn 写入它)——只有这两个 viewer 写入点漏掉了它。它经既有的 `sessions.scienceVersions` 读取(`packages/host/apiproxy/src/api-proxy.ts`)到达浏览器端的 `ScienceVersionSummary.producer.turn`，没有新增任何 wire 字段。

**客户端 trace model 优先使用 `producer.turn`，而不是时间戳兜底；时间戳兜底本身也不再在无解时硬猜一个 turn。** `buildScienceTraceModel` 按这个顺序解析一个 artifact 版本的 turn：`artifact.turn ?? summary.producer.turn ?? artifactTurn(...)`——先是 projection 归属坐标(产出它的 run 或 annotation 调用)，再是 store 自己的 `producerTurn`(一次 viewer 写入)，最后——只对两者都没有的版本，即这次修复之前就存在的直接人工编辑、import，或是一条 legacy 记录——落到最后一个已声明 `startTime` 早于或等于该版本 `createdAt` 的 turn。一个在 `createdAt` 之后才开始的 turn 从来不是候选，这就堵上了旧 `lastTurn` 兜底造成的空闲间隙漂移。以上都无法解析的版本——其 `createdAt` 早于本视图已知的每个 turn——会加入 `unassigned.artifacts`(此前文档写的是"永远为空")，与 `unassigned.runs` 并列；`ScienceTraceView` 既有的未归属历史区域与 `trace.unassignedSummary` 文案已经能不加改动地渲染两者，因此该文案不再声称缺失坐标是"产生调用不在已加载对话中"，只说该记录在本 trace 里没有所属 turn。这次修复不改动 `contentOrigin`——另存的副本沿用源的内容来源不变，绝不会被重新归类为人工编辑。

**Science persona 会让数据文件走 `run_python`/`run_r`，而不是 `read`/`glob`/`grep`，即使只是想先看一眼。** 在 `apps/cli/config/agent-presets/science/agent.cordis.yml` 的 persona 里新增一句话，点名表格格式(csv、tsv、xlsx、parquet、sav、dta、rds、json 数据)并说明理由：经 kernel 加载会留下一个别的 turn 能复用的命名变量，而 `read`/`glob`/`grep` 做不到这一点。`tool-science` 的 `STATIC_GUIDANCE` 携带同一事实里对应的 kernel 侧那一半——把加载好的表绑定到命名变量——放在既有的持久 kernel 那条之后，不重复 persona 里"该用哪个工具"这条规则(一事一处：persona 是"该用哪个工具"这个产品层事实的家，`STATIC_GUIDANCE` 是"进了 kernel 之后该做什么"这个工具层事实的家)。

**`annotate_artifact` 的描述告诉模型：对一个命名了但未见记录的 artifact，照样调用它并转达诊断信息，绝不捏造替代品。** 工具描述和 `logical_name` 的参数描述都加上了这条指示；`resolveAnnotateTarget` 既有的 `ARTIFACT_NOT_FOUND` 诊断(包括保留但未捕获光栅文件的恢复文案)本来就是可达且正确的——缺口纯粹在于模型从来没有为一个它没有记录的名字调用过这个工具，因此那些诊断从未真正跑到过。

## Alternatives considered

**让 `saveArtifactAs`/`performChartEdit` 在 store 写入那一刻才重新计算 `producerTurn`，而不是在方法入口。** 拒绝：重点本来就是用户动手那一刻正当前的 turn，不是 kernel 重放或排队租约落定之后随便哪个当下的 turn——推迟计算只会把漂移窗口挪个位置，而不是关掉它。

**给会话 fold 的 `applyArtifactSaved` 加一个也能匹配 viewer 写入合成标记的 `owner` 查找，而不是在 store 层写 `producerTurn`。** 拒绝：fold 的 `owner` 机制专门指"这次内容首次提交时打开着的那个工具调用"(这正是 `ScienceClientArtifactVersion.turn` 自己的契约)，而一次 viewer 写入按定义就没有这样的调用。store 层的 `producerTurn` 才是正确的家——它早就为 run-auto 捕获的同类事实存在了。

**保留旧的 `lastTurn` 兜底，只新增 store 的 `producerTurn`。** 拒绝：`producerTurn` 只在 runtime 写入路径被修好的地方堵住了缺口；一条 legacy 记录、一次从未带过 `producerTurn` 的直接人工编辑或 import，以及未来任何一个坐标缺失的版本，仍然会撞上同一个漂移兜底。把 `lastTurn` 换成"最后一个 `startTime` 早于 `createdAt` 的 turn，否则未归属"，修的是机制本身，不只是这一个调用点。

**把两句提示词都只放进 `STATIC_GUIDANCE`，反正它已经会到达每一次 Science 模型调用。** 就数据加载这条规则而言拒绝：persona 是"该伸手拿哪个工具"这件事在产品层的陈述，在每次会话开始时读一次，紧挨着它正在纠正的那条 `read`/`glob`/`grep` 指引；把同一句话再塞进 `STATIC_GUIDANCE` 会违反一事一处，却毫无好处，因为两个区块本来就会被组进同一份系统提示词。

## Consequences

`packages/science/science-artifact-store` 不受影响——`producerTurn` 早就是一个已建模的可选列；只有两个调用方改变了传入的内容。`packages/science/science-runtime/tests/save-as.spec.ts` 与 `chart-edit.spec.ts` 各新增一个用例，断言 `producerTurn` 记录的是会话最后一次已开始的 turn，且不受调用之后才开始的 turn 影响。`packages/client/ui-science/tests/science-trace.client.spec.tsx` 里此前那条钉住漂移兜底行为的用例("keeps legacy records without projection coordinates on the timestamp fallback")被替换为三个用例：空闲间隙的时间戳兜底落在前一个 turn 上、`producer.turn` 胜过一个会解析出不同结果的时间戳、以及第一个 turn 之前的版本落进 `unassigned.artifacts`。另外两个原本依赖已移除的 `lastTurn` 猜测的既有客户端测试，现在改为声明一个显式的 turn 计时窗口，与真实 Session 始终提供的事实一致。

keyless 的 `science-tools` 场景(`examples/headless-agent/tests/snapshots/science-tools/`)是端到端的证明：`source-agreement.expected.json` 的两个人工编辑版本现在都带上了 `producer.turn`，`model-view.expected.json` 逐字带上了改动后的两段提示词文本——两者都用 `DSH_SNAPSHOT=refresh` 刷新过，因为驱动脚本与模型响应都没变，变的只是快照观察到的 runtime 行为与提示词文本。`docs/tool-catalog.md`/`.zh.md` 是从同一份源 JSDoc/工具描述重新生成的。

persona 与 `STATIC_GUIDANCE` 的新增只是提示词文本，不涉及任何 schema、工具或 wire 改动。Science 子代理自己那份更窄的 persona 早就写着"自己用 `run_python`/`run_r` 读取或重新计算你需要的任何数据"，本次未改动——它不像父 persona 那样把 `read`/`glob`/`grep` 列成一个可选项，因此没有对应的缺口需要补。
