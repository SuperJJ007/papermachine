# 学科包计划整体可行性审查

- Owner:Fable(审查人);对象:本目录四份 Codex 草案(SCIENCE-PROMPT-PROPOSAL、pack-social-science、pack-biology、pack-business-analysis)
- 日期:2026-08-26
- 性质:可行性裁定,不是逐条内容取舍。具体加哪些不加哪些等实现后测试再定。
- 退休条件:学科包首发落地(内容进入正式 preset 层并配套 snapshot)后,本文结论并入对应 Agent Note,删除本文件。

## 总结论

**计划整体可行。** 四份草案没有发现事实错误,其内容结构与 dsh 现行架构的插槽一一对得上。可行性按四个能力域分层,各域有独立的最短路径,互不阻塞:内容层现在就能做,身份层已在交付中,装配层是决策问题而非开发问题,产品能力层是独立工作线且都有低成本首步。首发(社科先行)不被任何未建成的能力卡死。

## 事实核验记录

抽查了草案所有可在代码里核验的声明,全部属实:

| 声明 | 核验位置 | 结果 |
|---|---|---|
| 捕获白名单 csv/json/md/png/txt | `science-runtime/src/capture.ts:30` | 一致 |
| `artifact_inputs` 精确版本、`edit_of` 精确父版本、三个 SCIENCE 目录 | `tool-science/src/run.ts`、`index.ts` | 一致 |
| kernel 重启五原因、`pip install`/`install.packages()` 生命周期 | `tool-science/src/run.ts:272-273` | 一致 |
| 现行 persona 原文与 preset 组成(五工具+只读 fs+skill+ask-user/todo,无 shell/写/Web/delegation) | `apps/cli/config/agent-presets/science/agent.cordis.yml` | 一致 |
| Runtime 不把 workspace 授予 Kernel,数据入口只有 `artifact_inputs` | kernel/run 的 cwd 均为 scratch 目录(`kernel-process.ts:371`、`index.ts:834`) | 成立 |

草案的能力诚实纪律可靠:所有未装配能力都标"待 provisioning",没有把候选写成事实。FRED 条款禁 LLM 关联使用的红旗经查属实且有价值。

## 能力域一:纯内容层(skill + prompt 增补)——现在就可行

学科包的主体是按需加载的 skill 内容、相对通用 prompt 的短增补和环境声明。承载插槽全部现成:

- persona 自由文本(`dsh-persona` 的 `config.text`)是学科 prompt 增补的落点;通用科学实践层的 owner 待定(persona 承载或独立 section),这是实现期决策,不是可行性障碍。
- preset 层 skill 注册已在 science preset 内运转(`skill-filesystem` + `tool-skill` 两行),学科 skill 目录照此放入学科 preset 即可;草案的"入口 skill 路由窄模块"结构与该机制匹配。
- `tool-science` 的 `profileId`/`modeRevision` 是 preset 显式配置,学科 preset 可声明自己的值。

约束:通用科学实践候选文本约 9 段、各学科增补约 6 段,都进稳定 prompt,固定 token 成本必须在实现期用真实组装量一次;所有模型可见改动走 keyless snapshot 门禁(草案自己也把这列为验收条件)。

## 能力域二:身份层(presetId 泛化)——已在交付中

学科包成为独立 preset 的唯一代码障碍是四个 science 身份锁,2026-08-26 复核全部仍在:

1. `science-session/src/applicability.ts:29` — 非 `science` preset 出 Science 事件直接 throw
2. `science-session/src/types.ts:31` + `codec.ts:114` — `presetId: z.literal('science')` 写进耐久事件 schema
3. `tool-science/src/context.ts` — `isScienceSession` 判 id 相等;`mode-bound` 硬编码 `presetId: 'science'`
4. `apps/cli/config/agent-presets/science/preset.yml` — `copyable: false`

放宽方案已定(presetId 记录实际学科 preset id、家族合法性由 preset 元数据判定)并作为 rider 排入正在进行的 S2 schema 变更波,快照只翻一次。rider 落地后,新学科包 = `agent-presets/` 下新目录,纯内容工作,不再动 `packages/`。若 rider 因 S2 上下文预算被顺延,它成为学科包首发的唯一前置代码工作,规模一个小 PR。

## 能力域三:装配层(能力接入)——决策问题,不是开发问题

草案把文献检索类工作流标为"待 connector provisioning",但仓库已有完整 web 能力:`packages/web/` 下 `dsh-web`(Service Definition)、`dsh-tool-web`(Consumer)、`web-fetch-http` + 三个 search provider。给学科 preset 接入文献能力是 preset 加行 + 产品决策 + snapshot,不需要新开发。science preset 注释明言"缺某能力是独立产品决策,不是 YAML 编辑"——这条边界应保持,但可行性上文献线没有被卡死。官方数据 API(World Bank/OECD/Census 等)的只读接入同理可走通用 web fetch 起步,专用 connector 后置。

## 能力域四:产品能力层(独立工作线)——各有低成本首步

草案正确识别的三个产品缺口,逐个评估最短路径:

**输入传输(input transport)**:现行数据入口只有 `artifact_inputs`。最短路径是"workspace 文件导入为 artifact":模型侧读能力已有(只读 fs),S1 store 已能存任意字节 + 任意 `mediaType`(`science-artifact-store/src/types.ts` 中 `mediaType: string`,无白名单),缺的只是一个导入动作(工具或 UI)把 workspace 文件写成 artifact 版本。这使社科/商业包的 CSV/XLSX 场景在 S 线完成后即可低成本打通;生物包的 FASTQ/BAM 大文件场景仍需独立设计(体积与 blob 存储策略),首发不含。

**Artifact 媒体扩展**:五格式白名单只存在于 runtime capture 一处(`capture.ts:30` 的扩展名→mediaType 映射);store 层无此限制。扩格式 = capture 映射 + UI 呈现 + snapshot,单点改动。XLSX/Parquet 捕获是中等规模工作,不是架构问题。

**环境 provisioning**:学科环境包(R survey 生态、Bioconductor 等)依赖 v2 桌面线 D2 的 micromamba 环境管理设计,机制上 Runtime profile 绑定既有 Conda prefix 的通道已在。学科包首发可以只带"环境声明"(草案已按此设计),实际装包随 D2 走,两线解耦。

**政策与法务挂账**:生物包的临床/生物安全边界需要 DSH 自有 policy owner(草案自己声明其边界稿不是正式政策),建议单独立项,不随学科包首发;FRED 默认不接入直至法务明确;所有外部 connector 首发一律不进(三份草案的自建议一致,采纳)。

## 与现行路线图的关系

依赖排序:S2 rider(presetId 泛化)→ 学科 preset 骨架(新目录 + 元数据 + snapshot)→ 社科包内容首发(skill + prompt 增补 + 环境声明)→ workspace 导入(S 线完成后)与环境 provisioning(D2)按各自线并入。生物包组学执行部分和全部 connector 明确后置。学科包不改 agent-loop、不动能力 seam 结构、不新增事件类型(rider 之外),与 S 线/UI 线无文件冲突,可并行。

## 风险清单

- 固定 token 成本未量化:通用实践 + 学科增补都进稳定 prompt,须在实现期以真实组装测量并按需下沉到 skill。
- snapshot 面大:persona/静态指导任何一字都翻全量 science snapshot;应与 S2 的快照波合并或紧随其后,避免多次全翻。
- 生物包首发价值受限:组学执行被 input transport 卡,文献被 web 装配决策卡;首发只有设计/计划层价值,排序上社科先行的既定决策正确。
- `copyable: false` 与学科 preset 的关系(学科包是官方 preset 还是用户可复制模板)是产品决策,rider 实现时一并定。

## 结论

批准进入下一阶段:等 S2 rider 落地后,以社科包为首发对象写实现 brief;三份 pack 草案与提议稿保留为内容输入,逐条取舍在实现测试阶段完成。
