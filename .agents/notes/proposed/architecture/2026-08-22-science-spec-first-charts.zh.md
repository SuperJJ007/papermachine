# Agent Note: Science 的 spec-first 图表产物

Status: proposed

[English](2026-08-22-science-spec-first-charts.md) | 中文

## 问题

[产物领域与图片编辑 note](2026-08-22-science-artifact-domain-and-image-edit.zh.md)的 S4 分片设计了对已捕获 raster PNG 上归一化像素区域的框选编辑——那也是当时 Science 唯一产出的图表表现形式。2026-08-21 的产品决策改变了默认图表创作路径:图表产物应当是一份声明式 spec,在浏览器中渲染为 SVG,查看器可按结构(某个 mark、某个 encoding)而非像素坐标选中元素,并配一个直接改 spec 样式属性的轻量编辑器。这个决策让 S4 的 raster 框选与 S1–S3 的 `artifact_inputs`/`edit_of` 管线继续服务于摄影/像素内容以及没有对等 spec 的图表库,但它升级了"默认图表"的含义,并新增了一个前一份 note 从未设计过的、纯人工的编辑入口:一次没有 run、也没有模型轮次背书的新字节提交。接下来的 Science 图表工作被六个决策挡住——spec 格式、agent 如何产出 spec、如何在不破坏当前每个产物 Version 都持有的 run-centric 溯源的前提下记录一次人工样式编辑、一次选择如何以结构化消息抵达模型、确定性导出在哪里渲染,以及 raster 框选是否还有存在的必要。以下每一条都对照前一份 note 已经立下的两条规则来定夺:内核驱动不改,且每个模型可见输入都必须能从某个 session 事件重建。

## 提案

图表产物获得第二个内容家族——声明式 spec——与 Science 已经捕获的 raster PNG 并存;`run_python`/`run_r`、内核线协议、`.png`-only 的图片捕获路径都不变。spec 是一个普通的 run 产物,和 PNG 完全一样:agent 的绘图代码把它写到 `SCIENCE_ARTIFACT_DIR` 下,自动捕获走同一个走查流程接纳它。人工样式编辑是一条独立的新溯源路径:轻量编辑器提交一个背后没有 run 的新产物 Version,因此 `ScienceArtifactVersion` 当前这套 run-centric 字段无法照实描述它,该类型需要一个判别式分支。领域里的其余部分——以 `{artifactId, version}` 表达的产物身份、以 `parent` 表达的祖先关系、`publish_outcome` 的证据、Notebook 投影——都不变。

### 1. Spec 格式:Vega-Lite,经 Altair 从 Python 生成

Spec 格式选 Vega-Lite:一份 JSON 文档、一个维护中的 SVG/canvas 渲染器(`vega`/`vega-lite`,通过 `vega-embed` 嵌入)、可按结构路径寻址的 mark/encoding(`mark`、`encoding.color` 等)——正是"按结构而非像素选择"这条要求所需要的。[R5](../../implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.zh.md) 曾明确拒绝"采用通用图表 spec 或绘图依赖",理由是当时 Python/R 代码已经产出 attachment service 校验过的 raster 输出;现在采用 Vega-Lite,是选择一个维护中的渲染器而非自己动手造一个,与[依赖优先于手搓的政策](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.zh.md)为 harness 代码定下的取舍方向一致——本文如何在不触碰 R5 已交付决策的前提下重新打开这一条 alternative,见下文"## Supersession 校验"。Python 侧,Altair 是符合语言习惯的 Vega-Lite 绑定:`chart.save('fig.vl.json')`(或 `.to_json()` 加一次文件写入)直接产出 spec。这属于 agent 指引,不是 harness 依赖:内核运行所在的 conda 环境由用户提供,因此这里不会给任何 `package.json` 添加 Altair;静态 Science 指引会推荐它,就像它已经点名 `SCIENCE_ARTIFACT_DIR` 却不随附任何写入它的库一样。R 侧没有对等的成熟度:没有哪个维护中的 R 包能以接近 Altair 的覆盖度产出 Vega-Lite JSON,把 ggplot2 的语法翻译到 Vega-Lite 的 encoding 模型也没有公认的无损映射。v1 中 R 图表继续走 ggplot2/base-R 的 raster PNG,通过既有的 raster 路径捕获与编辑(决策 6)——这是明确的降级,不是桥接方案的占位符。

### 2. Agent 如何产出 spec:普通的 run 产物,内核与工具都不改

[`capture.ts`](../../../../packages/science/science-runtime/src/capture.ts) 的 `CAPTURE_MEDIA_TYPE_BY_EXTENSION` 按 `extname()`(路径的最后一段后缀)取键;`.json` 已经映射到 `application/json`,所以一份 `.vl.json` 文件今天在技术上已经满足 capture 资格,但它会与任何其他 JSON 产物(比如随附示例 fixture 里的 `meta.json`)一起坍缩到同一个通用媒体类型上,查看器无法区分一份 Vega-Lite spec 与一份任意结果文件。方案是:在既有的单段后缀查找之前,先识别两段式后缀 `.vl.json`——这是 `isCaptureEligible` 与媒体类型查找内部的一处局部改动,不涉及目录走查或内核——映射到 [`dsh-attachment` 封闭联合类型](../../../../packages/attachment/attachment/src/types.ts)上新增的一个 `TextMediaType` 成员:不带版本号的 `application/vnd.vega-lite+json`。Vega-Lite 自己的约定已经把 `.vl.json` 这个文件名与文档内部携带确切 spec 版本的 `$schema` 字段配对,所以媒体类型不需要再固定一个版本——带版本的媒体类型会让每次 Vega-Lite 主版本升级都被迫改动允许列表与联合类型,却不提供任何 spec 字节本身不携带的信息。spec 的字节走既有的 `saveText` admission 路径,不需要任何改动:JSON 文本不带被捕获图片才有的 EXIF/sRGB/缩放归一化问题,不需要新的字节精确性豁免。不需要新工具:agent 已经在向 `SCIENCE_ARTIFACT_DIR` 写入;capture、`annotate_artifact`、`publish_outcome` 以及 `edit_of` 基线机制已经在通用地操作 capture-relative 路径与媒体类型,今天怎么处理 `.csv` 或 `.md`,就会怎么处理一份 spec 文件。

### 3. 人工样式编辑的溯源:一个判别式的 `origin` 分支

[`ScienceArtifactVersion`](../../../../packages/science/science-session/src/types.ts) 除身份与内容外的每个字段都是 run-centric 且必填的:`runId`、`toolCallId`、`requestHeaderSeq`、`environmentRevision`、`environmentFingerprint` 都是在把这个 Version 授权给某次模型发起的 run。人工在编辑器里直接做的样式编辑没有这些事实——伪造出来会把从未发生过的授权说成真实发生,并破坏每一个当前把这些字段当作字面事实来信任的消费方(`publish_outcome`、replay、Notebook 投影)。修法是给 `ScienceArtifactOrigin` 加第三个值 `'human-edit'`,并把 `ScienceArtifactVersion` 按 `origin` 拆成一个判别式联合类型:既有的 `'auto' | 'model'` 分支保留当前每一个字段不变(包括 `parent` 仍是可选的,只在某次 edit baseline 命名了它时才填);新的 `'human-edit'` 分支去掉 `runId`/`toolCallId`/`requestHeaderSeq`,并把 `parent` 变为必填——一次样式编辑永远是在重新给某个既有 spec Version 换样式,绝不会开出第一个 Version。`environmentRevision`/`environmentFingerprint` 从这个必填的 `parent` 拷贝过来,而不是直接丢弃,这样 `publish_outcome` 的 environment revision 推导以及其他每一个假定这两个字段存在的读者都不需要为它单开一条分支;这两个值描述的是底层数据来自哪个 environment,而一次纯样式编辑不会改变这一点。排序与持久性也不需要一个 `requestHeaderSeq` 替代品:`science/artifact-saved` 事件自己在 session 日志里的 `seq` 已经把一次人工编辑相对其他每个事实摆在了正确的时间位置上,而 `requestHeaderSeq` 存在的意义正是把一次*模型发起*的动作授权给某个具体请求,一次直接的 UI 编辑不属于这一类。严格 fold 校验镜像[S1 的规则](2026-08-22-science-artifact-domain-and-image-edit.zh.md):`'human-edit'` Version 上无法解析的 `parent` 会让 fold 大声失败,与今天无法解析的 `edit_of` 基线一样。`SESSION_FORMAT_VERSION` 保持 `0`;pre-release 立场意味着这次拓宽 schema 不需要兼容层。

### 4. 选择与编辑消息:复用既有的结构化消息与 image block 扩展点

结构化载荷是一条持久、模型可见的 `user/message`:`{artifactId, version, target: specPath | normalizedRegion, instruction}`,不新增事件类型。两个既有扩展点恰好承载这个形状。[`ContentBlockMap`](../../../../packages/llm/llm/src/types.ts) 已经有一个角色中立的 `ImageBlock`(`{type: 'image', attachment}`),在用户内容里合法——这个 block 是 rc.2 合并时建立的,让一条用户消息能携带一个精确的 attachment 引用,[DeepSeek 线协议 adapter](../../../../packages/llm/llm-deepseek/src/types.ts) 会把它转成一个 `image_url` 内容部分;raster 或降级 raster 目标上的选择不加改动地复用它,附上精确选中的那个 Version。[`MessageSourceMap`](../../../../packages/llm/llm/src/message.ts) 被文档记录为"merge-extensible sum type——插件添加自己的 kind",而且已经有若干个包在这样做:[`dsh-skill` 的 `'skill-invocation'` key](../../../../packages/skill/skill/src/index.ts) 是最贴近的先例,一段 `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'skill-invocation': SkillInvocationSource } }` 携带生产方专属的结构化数据。`tool-science` 用同样的方式加一个 `'science-edit'` key,在消息的 `source` 上携带持久的 `{artifactId, version, target, instruction}` 伴随数据。经检查,`serialize.ts` 从不读取 `source`——所以这份伴随数据只进持久日志,绝不发给模型;消息的 `content` 用一个模型真正会读到的 `text` block 渲染同样的事实(spec 路径或 region,加上 instruction),这正是这条消息之所以模型可见的原因。对 spec-path 目标,content 只有文本(模型已经在更早的 run 结果里见过该 spec 自己的 JSON,或者可以主动请求它);对 region 目标,content 还会带上 `ImageBlock` 引用,让模型编辑它实际看到的东西,与前一份 note 的 raster 设计完全一致。

### 5. 定稿导出:客户端渲染,派生附件,而非新 Version

PNG/PDF 渲染在客户端跑,复用 C1 挂载进 Web 查看器的同一个 Vega-Lite/Vega 渲染器(`view.toImageURL(...)`/`toSVG()`),而不是新增一个 Host 侧无头渲染器。导出物是一个派生附件,不是一个新的产物 Version:[`ScienceArtifactVersion` 自身的约定](../../../../packages/science/science-session/src/types.ts)写明"一个 Version 就是某个请求轮次产出的东西",而一次导出渲染的是某个请求轮次已经产出、也已经记入日志的字节——它不创造任何新内容,这与前一份 note 的 S5 notebook bundle 一致,后者始终"是一个纯投影……除非用户显式保存该 bundle,否则不创建任何 Artifact"。导出的可复现性门槛被有意设得比 capture 低:被捕获的图片是字节精确的科学证据(逐字 admission,不做任何归一化);导出物则是对已经记入日志的 spec 与数据所做的一次面向人类消费的渲染,因此不同查看器之间的字体或 canvas 差异是这份便利交付物可以接受的代价,而不是对 capture 所立字节精确性规则的违反。Science 不止一个 Client——自动化专用的 ACP server 与 headless CLI 示例都没有浏览器可供渲染——因此要在那些 Client 上取得对等能力需要一个 Host 侧确定性导出器;本文把它的建设推迟到确实有非 Web Client 提出 PNG/PDF 导出需求为止,而不是在没有现存消费方的情况下先添加一个新的 Host 渲染依赖(无头浏览器或原生 canvas 绑定)。

### 6. Raster 框选保留

S1–S3 的 `artifact_inputs`/`edit_of` 管线与前一份 note 的 raster 框选入口原样保留,覆盖摄影/像素内容以及每一种降级 raster 图表(matplotlib、ggplot2,或任何没有 spec 输出的库)。它们共享决策 4 的消息格式,只在 `target` 上有别:spec 支撑的图表用 `specPath`,其余 raster 情形用 `normalizedRegion`。

## Supersession 校验

[R5](../../implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.zh.md) 的 Alternatives-considered 一节拒绝了"采用通用图表 spec 或绘图依赖",理由是"Python/R 代码已经产出输出,attachment service 也校验了 raster 字节"。本文只为默认的 Python 图表创作路径(决策 1)重新打开这一条 alternative;R5 已交付的发布、溯源与呈现决策(`annotate_artifact`、`publish_outcome`、Outcome revision 模型)不受影响,继续有效——因此这是对某一条 alternative 的部分 supersede,不是对 R5 决策本身的 supersede,R5 保持 active,不进 archive。[产物领域与图片编辑 note](2026-08-22-science-artifact-domain-and-image-edit.zh.md)因其 S1–S3 分片(已交付)与领域记录(产物身份、依赖边、Notebook 投影)保持 active;本文只 supersede 该 note S4 分片的范围,把 S4 收窄到 raster/降级图表路径(决策 6),而 spec-first 图表遵循决策 1–5 设计的管线。没有其他 active 的 Agent Note 覆盖 spec 格式、人工编辑溯源或 Science 消息结构。

## 实现分片

1. **C1 —— spec 捕获与查看器渲染**(`science/s4a-spec-capture`)。决策 2 的 allowlist/媒体类型改动,加上在 Web 查看器里挂载的客户端 Vega-Lite 渲染器。验收:真实会话里 Altair 出图被捕获、渲染为矢量 SVG,并可切换 Version;keyless snapshot 加一份 GIF(产品可见的 GUI 改动)。
2. **C2 —— 选择 → 结构化编辑消息**(`science/s4b-select-message`),用一条 raster 兜底路径闭合前一份 note 的 S4 验收标准。查看器为 spec-path 选择与 region 选择都发出决策 4 的消息;agent 用 S1–S3 已经支持的 `artifact_inputs`/`edit_of` 闭环。验收:一段真实 server/model 流程的 GIF、一份结构化消息的 keyless snapshot;如果 C0/C1 延误,C2 可以先只在 raster 路径上落地,让前一份 note 的 S4 验收标准依旧被满足。
3. **C3 —— 样式编辑器**(`science/s4c-style-editor`)。选中元素打开一个限定在安全样式子集(颜色、字号、标签——绝不含数据变换,那属于 agent 的地盘)的属性面板;定稿提交一个决策 3 的人工编辑 Version。验收:一份 GIF、对新判别式 schema 分支及其严格 fold 校验的单元与 snapshot 覆盖。
4. **C4 —— 导出**(`science/s4d-export`)。实现决策 5。验收:导出的 PNG/PDF 是对确切 spec Version 的一次可信渲染,不要求跨环境字节相同(决策 5 的既定代价);一份 GIF。

## 拍板记录(2026-08-22)

用户接受了决策 1–6,并对本文原先留待开放的三个问题做出裁决:

- **媒体类型**:采用不带版本号的 `application/vnd.vega-lite+json`,并入决策 2;spec 的 `$schema` 字段是版本的权威来源。
- **Host 侧确定性导出**:维持推迟,并定下具体触发条件——当某个具体的非 Web Client 承诺支持 Science 图表时才建设,此前不建。
- **人工编辑归属**:不做比 `'human-edit'` origin 更细的粒度。部署本身是匿名单用户的([`dsh-anonymous-user-id`](../../../../packages/identity) 是部署级身份);按人归属的字段没有任何消费方。

结构化编辑消息 `text` block 的确切渲染措辞（决策 4）由 C2 的 keyless snapshot 与下文 C2 实现评估锁定。

## C1 依赖评估(2026-08-23)

C1 钉下 `vega-embed@7.1.0`(闭包:`vega@6.4.0`、`vega-lite@6.4.3`)作为 `dsh-client-ui-science` 唯一新增的运行时依赖;`THIRD_PARTY_NOTICES.md` 列出该直接依赖(BSD-3-Clause),闭包由 lockfile 承载。实测成本:`lib/client.js` 增至约 2.0 MB(gzip 约 475 KB),约为次大客户端插件的 4.5 倍,且只要插件挂载就静态加载。对照 maintained-dependency 标准接受进 v1——该渲染器替代的是一整个本要手写的图表面——按需加载记入 ui-science README 的已知限制而非投机性先建。C3 关闭外部加载风险:ui-science 向 `vega-embed` 传入自定义 loader,拒绝 HTTP(S) 与协议相对地址;远程 `data.url` 会降级为带说明的 JSON tree,内联值仍可渲染。

## C2 实现评估（2026-08-23）

C2 在 `dsh-tool-science` 新增一个 `scienceEdits` Typert Remote；Web 在与 Typert Gateway 共享的 Host root 挂载其 `./edit-service` 入口，而 agent preset 只挂载面向模型的 Consumer。浏览器只能提交确切 artifact 引用、判别式 spec-path 或 normalized-region 目标与修改要求，Host 则在准入前解析在线 Agent 并 fold 其完整 session。所选版本必须是该 artifact 当前已提交版本：引用缺失、目标格式错误、媒体类型不匹配或版本陈旧都会以稳定的 `SCIENCE_EDIT_*` code 拒绝，没有任何分支替换成 latest。获准的 `user/message` 在 `source.kind: 'science-edit'` 下携带完整请求；其四行文本依次写明逻辑 artifact 与确切版本、所选目标、修改要求，以及必须把该版本同时作为 `artifact_inputs` source 与 `edit_of` parent。Raster 消息还附带确切被选中的图像。Keyless Science runnable snapshot 把这条结构化消息的两种目标类型都提交给组装后的 agent，mock model 随后以一致的 `artifact_inputs` 与 `edit_of` 发起 `run_python`；产出的 `selected-edit.vl.json` 与 `region-edit.png` 事件断言 `parent` 等于被选中的版本。真实 server/model 浏览器 GIF 仍是 C2 最后一项产品验收证据。

C2 的真实 server 流程还暴露了 `dsh-science-runtime` 中一个相邻缺陷：`assertSession` 仍以 session 冻结的创建 header（`header.agentPreset === 'science'`）为准，拒绝所有通过 [per-session preset 设计](../../implemented/architecture/2026-08-03-per-session-agent-presets.zh.md)已交付的 `agent-preset/selected` 机制重组进 science preset 的 Web session。该守卫现在只以持久的 `science/mode-bound` 事实为准：这一事实只由 science preset 自己的 Consumer 追加，所以 Runtime 实际依赖的授权是 mode 绑定而非创建 header，重组后的 session 与原生 science session 在完全相同的条件下获准。记录在此是因为 C2 验收路径是它的第一个消费者；README 与一个 environment 回归测试承载该行为。

## C3 reader 复查(2026-08-23)

开工前要求的复查为 `ScienceArtifactVersion` 的每个 reader 定下如下行为:

| Reader | `human-edit` 行为 |
|---|---|
| `science-session` `types.ts` / `codec.ts` | 持久值与 client 值改为严格判别式联合。人工分支要求 `parent`、环境字段与 Vega-Lite 文本,不含 run/tool/request 字段;run 产出分支保持不变。 |
| `science-session` `fold-state.ts` / `domain.ts` / `invariant.ts` | 这些位置只保留或分发完整 Version,无需 origin 专属策略;invariant 仍在发布前执行同一条严格 transition。 |
| `science-session` `transition.ts` | 人工编辑必须开出下一个连续 Version,parent 必须解析成同一 artifact 当前已提交的 Vega-Lite Version,新内容也保持 Vega-Lite 媒体类型,环境字段从 parent 复制,提交时间不得早于 parent fact。它不能开出 v1、原地 supersede,也不消费 run/request/tool 溯源。 |
| `science-session` projection value/schema | 浏览器收到人工分支的确切 parent、attachment、环境预览与提交时间,没有伪造的 run 链接;projection 校验镜像严格持久联合。 |
| `science-runtime` capture / inputs / public types | Capture 仍只创建 run 产出的 Version。输入与 edit baseline 物化本来就只依赖确切身份和 attachment bytes,因此原样接受人工 Version;共享环境字段让后续 run capture 与 `edit_of` 谱系保持确切。 |
| `science-runtime` annotation | `annotate_artifact` 拒绝人工 Version:把它转为既有 `model` 分支会抹掉直接编辑判别,保留 `human-edit` 又无法携带 annotation 当前证明的模型 tool 授权。日后若要混合溯源,必须显式设计,不能从祖先 run 推断。 |
| `tool-science` run / state / artifact schema | Run 回执仍只含 run 产出。模型状态把 `runId` 改为条件字段,为人工 Version 上报 `parent`,并明确直接编辑 origin,不虚构来源 run。 |
| `tool-science` edit message | 确切版本选择原本就只依赖 artifact 身份、attachment 媒体类型与 target,因此人工 Vega-Lite Version 仍可再选中交给 agent 编辑,不会回退到 latest。 |
| `publish_outcome` | 图表 evidence 继续从被引用的确切 Version 推导 `environmentRevision`;从 parent 复制的环境让人工 Version 无需特殊分支也能作为 evidence。 |
| Notebook projection | 当前源码树没有 notebook artifact projection;暂缓的 C5 bundle 因而没有 C3 reader 需要修改。持久/client projection 仍是它未来的输入。 |
| `tool-cordis` API catalog | 生成声明必须从新的 public union 重新生成;它绝不作为独立 reader 手工编辑。 |

样式子集限制属于 editor UI,而不是 Host 准入。人本来就能要求 agent 运行任意代码,任意 Vega-Lite JSON 也无法由 Host 可靠判定何谓“仅样式”diff;因此 Host 校验 JSON object、大小、确切当前 parent 与媒体类型,面板只暴露有界的 v1 控件。

## C3 实现评估（2026-08-23）

C3 把 `ScienceArtifactVersion` 及其 client 投影实现为按 `origin` 严格判别的联合。run 产出 version 保留既有溯源；直接编辑则使用 `origin: 'human-edit'`，要求确切 parent 与 Vega-Lite 文本，复制 environment 溯源，且不携带 run/tool/request 字段。fold 只接受同一 artifact 当前已提交 Vega-Lite parent 之上的下一个连续 version，并校验 logical name、environment 与 parent-to-commit 时间。Host 的 `scienceEdits.commitStyleEdit` Remote 会先重放这条 fold，再通过 attachment store 准入完整 JSON object spec 并追加事件。Host 刻意不尝试对 JSON 做语义上的“仅样式”diff：Viewer 通过颜色、字号与 axis/legend 标题控件承载工作流限制；Host 准入只负责确切版本并发、JSON 结构、媒体类型与 attachment 上限。

Viewer 修改不可变工作副本，并为实时预览重新 embed；定稿成功后选择返回的 version，展示直接编辑谱系，而非伪造 run。自定义 Vega loader 拒绝 HTTP(S) 与协议相对数据加载，降级为带说明的 JSON tree。组装后的 keyless Science snapshot 经 Remote 提交一个人工 version，证明事件有确切谱系且无 run 字段，再证明下一次模型调用同时在 `artifact_inputs` 与 `edit_of` 使用该 version。该场景暴露了一个陈旧 workspace 边角：后续 run 原本可能把编辑前未变化的文件误捕获为虚假的下一 version。现在，当当前 version 为人工编辑、且该路径没有显式 edit baseline 时，自动捕获会跳过与最近 run 产出祖先相同的字节；显式 baseline 仍允许有意的模型编辑或回滚。

## Alternatives considered

- **把 R 图表桥接到 Vega-Lite。** v1 拒绝:没有哪个维护中的 R 包能以接近 Altair 的覆盖度产出 Vega-Lite JSON,自建一座桥本身就会成为依赖政策所警惕的手搓基础设施;R 图表已经有一条能用的 raster 路径。
- **新增一个专门用于保存 spec 的工具(比如 `save_chart_spec`)。** 拒绝理由与前一份 note 拒绝专用编辑工具相同:spec 是一个普通的 run 产物,新增一个保存工具会把 capture 走查已经在做的记账和 run 本身已经携带的溯源重复一遍。
- **让 `ScienceArtifactVersion` 保持单一扁平形状,为人工编辑伪造一个假 run。** 拒绝:伪造的 run 会把从未发生过的授权说成 `runId`/`toolCallId`/`requestHeaderSeq` 这些字面事实,破坏每一个当前把这些字段当真的消费方。
- **一开始就上 Host 侧无头导出。** v1 拒绝:目前没有任何非 Web Client 需要它,而且在没有现存消费方的情况下会新增一个 Host 渲染依赖;推迟建设的触发条件见「拍板记录」一节。
- **新增一个 `ContentBlockMap` 条目来表达结构化编辑目标,而不是新增一个 `MessageSourceMap` key。** 拒绝:新的 content-block 类型需要"跨每个 provider 的 adapter、UI 与 compaction 支持"(其自身文档注释所述),而 `MessageSourceMap` 正是为这种生产方专属的结构化伴随数据设计的,并且已经有五个包在实践这个模式。

## Acceptance criteria

- 决策 1–6 在 C1 开工前就以本文所述定稿;之后若要改动其中任何一条,属于一次新决策,在本文仍是 proposed 时以修订本文的方式记录,或在开工后另立一份后续 note。
- C1 把一份 Altair 产出的 `.vl.json` 以新媒体类型捕获为一个带版本的产物,并在查看器里渲染为可切换 Version 的 SVG,附 keyless snapshot 与一份 GIF。
- C2 从 spec-path 选择与 region 选择都能发出决策 4 的结构化消息,闭合前一份 note 的 S4 验收标准;agent 产出的编辑结果携带指向确切选中 Version 的 `parent`。
- C3 提交一个 `origin` 能与每一个 run 产出的 Version 区分开的人工编辑 Version,按决策 3 做严格 fold 校验,附一份 GIF 与对新 schema 分支的完整覆盖。
- C4 把 PNG/PDF 导出为一个派生附件,绝不是新的产物 Version,遵循决策 5。

## Risks

- 没有 R 侧的 spec 路径(决策 1)会永久性地把 R 图表限制在 raster/降级管线上;如果 R 的采用相对 Python 增长,这会变成一个反复出现的产品缺口,而不是一次性的代价。
- 判别式的 `ScienceArtifactVersion` schema(决策 3)是 `origin` 上第一个形状真正偏离 run-centric 基础的分支;C3 开工前,该类型当前每一个读者(`publish_outcome`、`annotate_artifact`、capture、Notebook 投影、呈现渲染)都需要针对新分支做一次明确审查,而不只是类型层面的窄化。
- 客户端 Vega-Lite/Vega 渲染器(决策 1–2)是一个带有真实包体积与供应链暴露面的新 Web 依赖;C1 锁定具体包版本时,要对照[维护中依赖的门槛](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.zh.md)评估它,而不是因为本文推荐了这个格式就默认它可以接受。
- 推迟 Host 侧导出(决策 5)有风险:日后某个非 Web Client 可能在时间压力下才提出这个需求,而不是作为一个有计划的分片;「拍板记录」定下的触发条件就是缓解手段——一旦有第二个 Client 承诺支持 Science 图表,立即建设。
- 一条引用了已被取代 Version 的结构化编辑消息(一次过期的选择)需要在 C2 里显式处理;前一份 note 那种发布前的 `INPUT_NOT_FOUND` 式拒绝是模板,不能静默地回退到最新 Version。
