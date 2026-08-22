# Agent Note: Science 产物领域、Notebook 投影与图片编辑

Status: proposed

[English](2026-08-22-science-artifact-domain-and-image-edit.md) | 中文

## 问题

Science 需要第一个人工内容操作——对精确产物 Version 的框选图片编辑——同时需要一个持久答案:产物数据如何流转、产物身份如何组织、Notebook 视图如何生长而不必日后重设计。设计输入是 [Claude Science 0.1.25 产物架构快照](../../../../docs/evidence/2026-08-22-claude-science-artifact-architecture.zh.md):凡 DSH 尚未持有更强立场之处,本文有意镜像其身份模型。三个产品约束限定以下所有选择:Science 成为部署的默认 agent 模式;preset 层在其上承载可安装的学科包;社区插件安装能力(extensions 子系统与 bundle patch 层)保持原样可用。

本文以上游 `dsh-v0.1.1-rc.2` 合并后的基座为前提:多模态 DeepSeek 消息(`image_url` 内容块)、统一图片附件管线和 composer mention 都已存在。

## 决定摘要

1. **持久内核驱动不改。**`kernel_python.py` / `kernel_r.R`、六字段 `RUN` 帧、FIFO 响应通道、fd 级输出重定向、`SIGINT` 中断语义和逐 run 的 `SCIENCE_ARTIFACT_DIR` 保持协议版本 1。Host 在发送 `RUN` 之前就拥有 run 私有目录,因此所有新能力都落在内核周边的 Host 侧,绝不进入内核内部。
2. **产物身份是交互通货。**每个入口——transcript 行、画廊、查看器标签页、未来的产物库与 mention——交换同一个可序列化选择 `{artifactId, version}`(仅在确实需要实时跟随处附带显式的跟随最新标志)。任何入口都不从文件名、工具结果文本或私有卡片缓存重建产物状态。这正是让 Claude Science 各界面读起来像一个产品的规则,在 DSH 长出更多入口之前先行确立。
3. **Version 号保持按请求轮次的序列;祖先关系成为显式字段。**[按请求轮次的 Version 决策](../../implemented/architecture/2026-08-19-artifact-version-per-request-turn.zh.md)对 agent 产出的保存保持不变。`ScienceArtifactVersion` 新增可选 `parent: {artifactId, version}` 记录编辑祖先,只由显式命名基线的操作填写。数值顺序表示时间;`parent` 表示祖先;v2 和 v3 可以同时源自 v1。
4. **Run 获得显式输入。**`startRun` 接受物化的产物 Version 输入;被消费的 Version 记录在 `science/run-started` 上。这是 Claude Science `artifact_dependencies` 的依赖边,落在 DSH 既有的 run 溯源上,而非另建一套图存储。
5. **Notebook 是投影,绝不是第二套历史。**会话 Notebook 视图和完整/裁剪 bundle 导出都从 Science 事件与 transcript 工具调用联接派生;任何 notebook 形态的东西都不拥有自己的持久状态。

## 保持不变的部分,以及内核为何不动

驱动被刻意保持哑:仅 stdlib/base-R,不向用户命名空间注入辅助函数,除了逐 run 导出的 `SCIENCE_ARTIFACT_DIR` 路径外不知道产物概念。图片编辑需要的是 run 工作目录里的输入字节和结算后更丰富的捕获归属——两者都是内核交换两侧的 Host 职责,零协议改动即可达成:

- Host 在发送 `RUN` 前写好 run 目录(源文件、cwd、捕获文件);物化输入只是多一次 `RUN` 前写入。
- 自动捕获在终态事实提交后走查 `SCIENCE_ARTIFACT_DIR`;基线感知的归属只是该走查上多一个事实。

保持线协议不变也让每个未来生产方都便宜:学科包、人工 notebook cell 通道或导入操作都复用同一个 `RUN` 交换和同一个捕获走查。向内核命名空间注入保存辅助函数被拒绝:那会在被日志记录的捕获流之外制造第二条保存路径,污染用户命名空间,并破坏模型可见 ⟺ 已记录的不变式。

## 领域记录

| 记录 | 所有者 | 语义 |
|---|---|---|
| Artifact(逻辑) | Science 会话投影(项目目录是延后的 seam) | 稳定 `ScienceArtifactId`、`logicalName`、最新版便利指针;组织元数据在项目目录 seam 落地时迁移过去。 |
| Artifact Version | `science/artifact-saved` 事件 | 不可变内容寻址附件加溯源(`runId`、`toolCallId`、`requestHeaderSeq`、环境修订/指纹)、按请求轮次编号,以及新增可选 `parent: {artifactId, version}` 编辑祖先。 |
| 依赖边 | `science/run-started` 的 `inputs` 字段 | 物化进 run 的精确 Version:`{artifactId, version, path}[]`。消费溯源,与祖先关系不同。 |
| Notebook 执行视图 | Science 事件 × transcript 工具调用的投影 | Cell 通过 `runId → toolCallId → args.code` 恢复并按 `codeSha256` 校验;按语言与 `kernelEpoch` 分组;没有持久 notebook id。 |
| 外部内容引用 | 延后 | 宿主文件背书的内容绝不展示为不可变 Version;引用为证据前先物化。 |
| Outcome | `science/outcome-published`(不变) | 固定精确 run、Version 与消息的证据支持修订。 |

## 数据流

### 输入物化

`StartScienceRunRequest` 新增 `artifactInputs?: readonly { artifactId: ScienceArtifactId; version: number; path: string }[]`。Runtime 对照实时 Science 投影解析每一项,经校验和读取路径读出附件,在发送 `RUN` 帧之前写入 `<runDirectory>/inputs/<path>`。`inputs/` 位于 `SCIENCE_ARTIFACT_DIR` 之外,物化字节因此绝不会被回捕成新 Version。拒绝均为发布前 `ScienceRuntimeError`:无法解析的 Version(`INPUT_NOT_FOUND`)、逃逸或在 `inputs/` 内冲突的路径(`INPUT_PATH_INVALID`)、超出配置的字节/数量上限(`INPUT_TOO_LARGE`;新的已验证 `Config` 字段,不是常量)。已提交的 `science/run-started` 携带完整输入映射,回放因此确切知道 run 消费了哪些 Version。Run 代码相对 cwd 读取 `inputs/...`。

### 编辑基线与捕获归属

`startRun` 同时新增 `editBaselines?: Readonly<Record<string, { artifactId: ScienceArtifactId; version: number }>>`,键为捕获相对输出路径。捕获走查时,路径命中基线条目的输出以 `parent` 指向该精确 Version 提交:已存在的逻辑名照常推进该 Artifact 的 Version;新逻辑名开启版本 1 的新 Artifact,其 `parent` 是跨 Artifact 分支边。陈旧基线(Artifact 已推进过它)仍以所指较老父版本提交——分支可见,绝不静默合并,与 Claude Science `version_of` 规则一致:基线必须显式,绝不从文件名推断。没有基线的捕获精确保持今天的行为,不带 `parent`。

### 图片编辑端到端

1. 查看器的框选入口作用于精确打开的 Version,发出携带 `{artifactId, version, 归一化区域, 指令}` 的结构化用户消息——它是消息,因此天然持久记录且模型可见,无需新事件类型。
2. 多模态模型把该精确 Version 的图片字节作为 `image_url` 内容块读入,编辑它看到的,而不是它记得的。
3. Agent 写普通 run 代码——图表走 spec 优先的重生成,照片类内容走像素操作——调用 `run_python`/`run_r` 并带上 `artifact_inputs`(被编辑的 Version 及所需数据)和命名输出路径基线的 `edit_of`。
4. 自动捕获以 `parent` 已设的方式提交下一个 Version;查看器把选择跟到新 Version,并可沿祖先导航。

### 不变的流

自动捕获资格、按轮次替换语义、`annotate_artifact` 元数据策展(绝不产生内容 Version)和 `publish_outcome` 都保持现有合同。图片的捕获扩展名 allowlist 初期保持仅 `.png`;确有需要时放宽到 `.jpg`/`.webp` 只是一个映射表改动(附件存储已准入这些媒体类型)。

### 证据字节与上游图片管线

上游的附件规范化(去 EXIF、sRGB、缩放、格式候选)服务于模型消费。Science 捕获是科学证据,必须保持字节精确:捕获固定文件的源字节;若合并后的准入路径会规范化,捕获必须使用字节精确的准入通道,或把规范化记录为溯源。这在切片 S2 中对照合并后的 API 解决,不做假设。

## 工具面

`run_python`/`run_r` 新增可选参数 `artifact_inputs` 与 `edit_of`,镜像 Runtime 字段(模型词汇:`artifactId` + `version` + 相对路径——模型已在捕获回执中收到这些 id)。回执命名祖先(`plots/fig1.png v4, edited from v2`)。不设专用编辑工具:一次编辑就是一次 run,单独的工具只会为零新增权威而复制 run 语义、内核选择和捕获记账。

## 默认模式与学科 preset

- Science 成为默认 preset 选择;Science host 行(`science-session`、`science-runtime/with-settings`)已在 web-app bundle 的 host 层,默认化是 preset 选择的改动,不是组合迁移。
- 学科包就是一个 agent preset:Science 名册加学科技能、prompt 段落和它的环境 profile id。Preset 不可叠加(`recompose()` 整体替换组合),因此学科包是 Science 名册的完整副本——这正是随附 `cordis`/`code` preset 已经确立的接受副本先例。从 Science 基座冲压学科包的 authoring 辅助,等副本数量增多再加才值得。
- `tool-cordis` 不进默认 Science agent。本设计不触碰社区插件能力:extensions 子系统(`cordis-host-runner`、`cordis-client-runner`、`ui-cordis`)留在 web-app bundle 的 host 面,部署级插件安装继续走 bundle `cordis.patch.yml` 层与用户 preset 根。

## 实施切片

每个切片在同一 PR 更新 README/JSDoc,保持逐文件覆盖率,并在模型或产品可见行为变化处新增或更新无密钥组装应用 snapshot。

1. **S1 — 会话模式。**`dsh-science-session` 的 `ScienceArtifactVersion.parent` 与 `ScienceRunStarted.inputs`:类型、严格 fold 校验(解析不到已提交 Version 的 `parent` 或输入即大声失败)、codec/投影/witness/checkpoint、invariant 伴生,以及无效祖先与输入的单元覆盖。
2. **S2 — Runtime。**`artifactInputs` 物化(上限、错误码、`inputs/` 落位、run-started 记录)与捕获走查中的 `editBaselines` 归属(既有名推进、新名分支、陈旧基线)。在此对照合并后的附件 API 解决字节精确证据通道。
3. **S3 — 工具。**两个 run 工具的 `artifact_inputs`/`edit_of`、回执与渲染更新、经真实可运行示例的 snapshot。
4. **S4 — 查看器入口。**精确 Version 上的框选发出结构化编辑消息;各处选择保持 `{artifactId, version}`;PR 携带真实服务器与模型流录制的必需 GIF。
5. **S5 — Notebook 导出。**确定性的完整/裁剪 bundle ZIP(`manifest.json`、`README.md`、`run.sh`、逐内核 `.ipynb`、所引输入/输出),纯投影;除非用户显式保存 bundle,不创建任何 Artifact。
6. **延后。**项目产物目录 seam、文件夹/复制/重命名、锚定批注、验证记录(与 Reviewer 一起设计)、保留/GC。

## 被拒绝的捷径

- **文件名当身份**——重命名、复制和跨 Artifact 分支都要求独立于路径与显示名的 id。
- **标题/说明变化推进内容 Version**——策展保持元数据;读者的历史不重复。
- **向内核注入保存或编辑辅助函数**——在被记录的捕获流之外的第二条保存路径、命名空间污染,以及未被记录的模型可见面。
- **把实时 Notebook 做成已保存产物**——执行状态、派生 bundle 和不可变 `.ipynb` 文件具有不同身份与生命周期。
- **专用编辑工具**——复制 run 语义;基线字段由 run 工具承载。
- **隐式跟随最新**——transcript 引用、Outcome 引证、diff 和编辑基线都固定精确 Version;跟随最新永远是显式标志。
