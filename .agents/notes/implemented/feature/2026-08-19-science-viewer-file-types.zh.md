# Agent Note: artifact viewer 按媒体类型渲染(csv/json/md/png)

Status: implemented

[English](2026-08-19-science-viewer-file-types.md) | 中文

## Problem

自动捕获(`2026-08-19-science-auto-capture.md`)已经把 `run_python`/`run_r` 写出的每个符合条件的 csv/json/md/png 文件持久保存下来，`annotate_artifact`(`2026-08-19-science-annotate-artifact.md`)也可以策展其中任意一个——但 `ui-science` 的 artifact viewer、其会话记录行，以及客户端安全的 presentation 类型，全都仍停留在只支持图片：gallery、Details 条目的内容分派、Outcome 行的证据小图，都会把非图片版本统统过滤掉。一个已被捕获的 csv/json/md 文件虽已持久化写入日志，却在人们会去查看的每一处都不可见。

## Decision

**Presentation 从"一张图表"泛化为"一份 artifact 列表"。** `tool-science/src/types.ts` 的 `ScienceChartPresentation`(一张图片，`kind: 'science/chart'`)被替换为 `ScienceArtifactPresentation`(`kind: 'science/artifact'`，`artifacts: ScienceArtifactPresentationItem[]`)——一个条目携带 `artifactId`/`logicalName`/`version`/`title`/`attachment`(宽高只在图片时出现)，故意省略了 `caption`/`runId`/`createdAt`：旧形状下 Client 行本来也不读取这几个字段，完整溯源信息只需一次点击就能从实时 `science` 投影拿到。`presentation.ts` 的 `scienceArtifactPresentation(items)` 在列表为空时返回 `null`，否则返回一个带标签的值——`annotate_artifact`(总是恰好一个条目)与新增的 `run_python`/`run_r`(每个被该次调用的捕获遍历产出的文件各一个条目，构建自 `run.ts` 的 `capturedArtifactSchema`，为此新增了 `title`/`attachmentId`/`attachmentName` 字段，且从不进入模型可见的回执文本)共享这一函数。

**两个专用行取代了那一个已死的 `save_chart` 行。** `ScienceChartRow.tsx` 更名为 `ScienceArtifactRow.tsx`，泛化到任意媒体类型(图片通过 `MessageImage` 渲染缩略图；文本渲染 `ArtifactFileTile`——一个静态的图标加扩展名磁贴，不发起加载)，并从 `save_chart`(一个已不存在的工具；这一行原本是死代码)重新以 `annotate_artifact` 为键注册。`run_python`/`run_r` 获得一个新的 `ScienceRunRow.tsx`：由于一次运行的主要内容就是其渲染文本(状态/stdout/stderr/捕获回执)，该行始终通过每个专用行共享的同一纯文本回退卡片渲染(`ScienceToolFallbackRow`，为此新增了一个 `after` 插槽)，当 presentation 指出有被捕获的文件时，在文本下方为每个文件追加一个可点击的引用小标签——一个紧凑的图标/名称/版本徽章，而非缩略图，因为一次运行一次最多可以捕获 `captureMaxFilesPerRun` 个文件。

**内容分派(`ArtifactContent.tsx`，新增)。** 从 `ScienceDetailsView.tsx` 中抽取出来：图片经由既有的 `MessageImage` "single" variant 渲染；文本附件通过一个新的 `loadText` 加载器(`science-attachment-loader.ts` 的 `createScienceTextLoader`，仿照 `createScienceImageLoader` 基于 `ISession.readTextAttachment`——已解码的 UTF-8，不需要 base64 步骤)取得已解码字节后再次分派：`text/csv` 经由一个新的 `ArtifactTable.tsx`，`application/json` 经由 `ui-primitives` 既有的 `JsonTree`(对解析结果不是对象/数组、或解析失败的内容回退为原始预格式化文本)，`text/markdown` 经由既有的 `MarkdownText`，`text/plain` 渲染为预格式化文本。`ScienceDetailsView.tsx` 的每个入口(gallery、标签栏、工具栏)现在都直接读取 `science.artifacts`——`hasImageAttachment`/`ScienceImageArtifactVersion` 过滤器已经移除。工具栏的放大控件(仅限位图)与工具栏触发的灯箱只在图片时渲染；下载会基于两种加载器之一构建 `data:` URI，文件名取自附件自身的展示名，或取自逻辑名(已经是被捕获文件的真实路径，包含扩展名)并把版本号插在扩展名之前。

**`ArtifactTable.tsx`/`csv.ts` 是本包内部组件，而非 `ui-primitives` 的导出。** 一次全仓库搜索没有在 `packages/client` 中发现任何表格组件，也没有第二个消费方；`csv.ts` 的解析器是手写的(类 RFC4180：带引号字段、字段内嵌逗号/换行、双引号转义)，而非一个依赖，因为这是对自动捕获或模型标注文件的只读预览，从不涉及任意不受信任的上传——"可配置性不能作为提供不受支持……公开操作集的理由"(`packages/AGENTS.md`)对一个投机性共享基础组件与对一个投机性格式同样适用。真正出现第二个消费方，才是把两者提升进 `ui-primitives` 的触发条件，而不是这一个。

**`ScienceOutcomeRow.tsx` 的证据小图** 现在区分三种情形而非两种：无法解析的引用(`chart === undefined`)仍报告"不可用"；已解析的非图片引用渲染 `ArtifactFileTile`；已解析的图片引用照旧渲染其缩略图。

**locale 命名空间从 `chart.*` 泛化为 `artifact.*`/`run.*`/`table.*`。** 预发布阶段，选择直接改名而非在新命名空间旁保留旧的：`chart.title`/`.open`/`.loading` 等改为 `artifact.*`(现在为每种媒体类型服务，不再只是图片)；新增 `run.titlePython`/`run.titleR`/`run.running`/`run.failed`/`run.stopped`/`run.artifacts` 服务于 Run 行；新增 `table.empty`/`table.sortBy` 服务于 `ArtifactTable`。`details.charts.title`/`.empty` 改为 `details.artifacts.title`/`.empty`；`details.artifact.select` 去掉了"chart"一词("Open {title}, version {version}"，而非"Open chart {title}...")。扩展名标签("CSV"、"JSON"、"MD"、"TXT")不做本地化，与未本地化的文件扩展名处于同一register。

**渲染的行数与字符数有上限，而非渲染整份文档。** `format.ts` 的 `capForDisplay`/`capTextForDisplay` 限定了真正抵达 DOM 的内容：`ArtifactTable.tsx` 最多渲染排序后行数中的 `MAX_ARTIFACT_TABLE_ROWS`(500)行；`ArtifactContent.tsx` 的 JSON 树与 `<pre>` 文本面板则以 `MAX_ARTIFACT_TEXT_CHARACTERS`(100,000)字符为上限——二者都是固定的展示上限，而非 `Config` 字段，沿用了 `ui-trajectory` 的 `trajectory-preview.ts` 已经确立的展示上限先例。任何被裁剪内容的上限都会显示一条"显示前 N 条/共 M 条"提示(`table.truncated`/`artifact.textTruncated`)，而非无声截断；超出上限的内容在该 viewer 中没有其他可达路径(见 README 的"已知限制")。

**只有一个 `artifactImageLabels(t)` 构造函数，而非三份内联复制。** `ArtifactContent.tsx` 导出它；`ScienceArtifactRow.tsx` 的行内缩略图与 `ScienceDetailsView.tsx` 的 gallery 磁贴都导入它，而不是各自独立构造同一个 `MessageImageLabels` 对象。

**自动捕获文件的工具栏只展示一次文件名，而非两次。** `capture.ts` 把自动捕获 artifact 的 `title` 设为其逻辑名的 basename；当逻辑名不带目录部分时，二者完全相同，因此 `ArtifactToolbar` 只在逻辑名与标题不同的情况下才渲染逻辑名那一行。

## Alternatives considered

**也给 `annotate_artifact` 的行加上列表渲染路径，与 Run 行对称。** 拒绝：`annotate_artifact` 的 presentation 总是恰好指出一个条目(该工具一次调用只策展一个 artifact)，列表路径不会有真实调用方；这种不对称是可解释的，而非偶然（已记录在"已知限制"中）。

**为 Run 行的每个引用小标签都拉取一张缩略图。** 拒绝：一次运行单次调用最多可以捕获 `captureMaxFilesPerRun`(默认 50)个文件；一整格急切加载的缩略图既在视觉上过重，又会引发一连串加载调用，去预览模型自己也未必想要内联查看的内容。一个紧凑的图标加文字小标签、点击后打开完整 viewer，与每个专用行已经在用的"行是指针，viewer 才是目的地"模式一致。

**新增一个共享的 `ArtifactThumbnail` 组件来分派图片与磁贴。** 拒绝：一旦非图片缩略图完全不需要发起加载(一个静态磁贴)，这个分派在三处调用点(`ScienceArtifactRow`、`ScienceDetailsView` 的 gallery、`ScienceOutcomeRow` 的证据小图)各自都收缩成一行三元表达式；包一层组件除了这行三元表达式之外不共享任何行为，只会多一层结构。

## Consequences

**模型可见文本未发生变化**；只有 `tool/result.meta`(从不发给 provider)新增了字段。keyless 快照(`examples/headless-agent/science-tools.cordis.snapshot.yml`)仍需要一次 `DSH_SNAPSHOT=refresh`，因为该快照的 stream-json/model-view golden 会捕获完整的 durable 事件流，包括 `tool/result.meta`——刷新后已重新确认在一次普通重放下保持稳定。

**`apps/web/tests/science-preset.snapshot.ts`** 把它两处 `annotate_artifact` result-meta 断言，从旧的 `{kind:'science/chart', chartVersion}` 形状更新为 `{kind:'science/artifact', artifacts:[{version}]}`。

**`apps/web/tests/science-chart-outcome.e2e.ts`**(既有、基于真实 Chromium)：它的 fixture 直接播种了一次 `save_chart` 工具调用与 `science/chart` presentation meta(绕过真实工具，因此在该工具历经改名乃至移除之后测试仍能通过)——此处已更新为 `annotate_artifact`/`science/artifact` 与"Open {title}..."措辞；每一条 redaction 断言(无绝对 Host 路径、无完整指纹)均未改动。新增一个同级场景 `apps/web/tests/science-artifact-types.e2e.ts`，播种一次 `run_python` 调用，其自动捕获产出 csv/json/md/png 各一个文件，驱动 Chromium 依次点击每个引用小标签，断言可排序表格(包含一次排序点击)、JSON 树、渲染后的 Markdown 与图片路径，最后以一份全新的 ARIA golden(`snapshots/science-artifact-types/panel.expected.md`)收尾。

**`packages/client/connection/src/client/fixture.ts` 中空的 `texts` map 有意保持未播种状态。** 它唯一的消费方(`fixture-commands.client.spec.ts`)从不涉及附件，目前也没有任何开发服务器或其他测试会通过这一特定 fixture world 来行使 `sessions.textAttachment`；现在播种它不会有任何所有者或需求(`packages/AGENTS.md`)。如果未来某个 GUI journey 测试开始专门通过这一 fixture 行使文本附件，再重新考虑。

**测试覆盖。** 新增：`csv.client.spec.ts`、`ArtifactTable.client.spec.ts`(包含一个直接针对 `compareCells` 的 describe，独立于 `Array.prototype.sort` 比较器调用模式，用于覆盖分支；以及行截断提示)、`ArtifactFileTile.client.spec.ts`、`science-run-row.client.spec.tsx`。改写：`science-chart-row.client.spec.tsx` → `science-artifact-row.client.spec.tsx`(任意媒体类型，不只是图片)、`ScienceDetailsView.client.spec.tsx`(按类型内容分派、非图片的 gallery/下载/无放大控件情形、resolve 与 reject 两条路径各自的"加载中卸载"竞态、CSV 行数上限、超大 JSON/超大纯文本的字符上限，以及工具栏标题/逻辑名的合并展示)、`science-outcome-row.client.spec.tsx`(新增的"已解析但非图片"小图情形)、`real-composition.client.spec.tsx` 与 `browser-plugin.client.spec.ts`(四个 toolview key、Details inject face 中的 `loadText`)。`tool-science/tests/tool-science.spec.ts` 新增了一个 `scienceArtifactPresentation` describe 与 `run_python` presentationMeta 单元测试(直接通过 `ctx.tools.get('run_python')?.output.presentationMeta` 获取，以便在不需要真实非静止态结算的情况下覆盖 `capturedArtifacts` 缺失/存在与多条目分支)。`apps/web/tests/science-artifact-types.e2e.ts` 断言完整的 `condaHistorySha256` 永远不会抵达渲染面板，与 `science-chart-outcome.e2e.ts` 中针对同一字段的既有断言相呼应。每个被改动的 `src/` 文件都保持逐文件 100% 覆盖率。
