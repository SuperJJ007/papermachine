# Agent Note：废止 `save_chart`，新增纯元数据的 `annotate_artifact`

Status: implemented

[English](2026-08-19-science-annotate-artifact.md) | 中文

## 问题

自动捕获([Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.zh.md))会在模型的下一回合之前，把每个合格的 run 写出文件持久保存下来。`save_chart` "从一次成功 run 的 artifact 目录导入一张 PNG" 的契约，在那项改动落地的那一刻就变得不诚实了：Runtime 早已捕获了该文件，因此再要求模型指定 `run_id`/`artifact_path` 并重新导入它，只是在重复 Runtime 已经做过的工作，还增加了一个模型可能出错的步骤，而且这条路径此前只接受 PNG。模型仍然需要一种方式来标记策展——"这就是最能展示我结果的那个文件"——但那是一次元数据操作，而不是字节搬运操作。`get_science_state` 的 `charts` 字段与 `run_python`/`run_r` 的结果文本此前也分别仍是 PNG-only 与不带回执的，两者都已在自动捕获笔记中被标记为待办后续工作。

## 决策

**`ScienceRuntime.annotateArtifact`**(`science-runtime/src/index.ts`)取代了 `commitChart`。它针对当前 live projection 解析所命名逻辑 artifact 的精确 `version`(或其最新版本)，并把**同一个**内容寻址的 `attachment` 重新提交为下一个连续版本，携带传入的 `title`/`caption` 与 `origin: 'model'`——从不接触文件系统或 `ctx.attachments`。除共享的 pre-publication 失败外，它唯一的失败模式是 `ARTIFACT_NOT_FOUND`(`logicalName` 或其命名的 `version` 不存在)。`CommitScienceChartRequest`，以及仅为字节导入路径而存在的 `SOURCE_RUN_NOT_SUCCESSFUL`/`INHERITED_RUN`/`IMAGE_TYPE_NOT_ALLOWED` 错误码，都被直接删除而不是作为不可达代码保留——处于 pre-release 阶段，不设兼容层。

**完全同步，但仍返回 `Promise`。** `annotateArtifact` 没有任何 `await`(纯元数据操作)，这会触发 `require-await` lint 规则对一个 `async` 函数的报错。直接去掉 `async` 会破坏其它所有 `ScienceRuntimeService` 操作都依赖的调用约定：一个在自己的 `async` 包装之外执行 `await scienceRuntime.annotateArtifact(...)` 的调用方，需要每一种失败——包括在任何 lease 存在之前就运行的 `assertSession` 自身的失败——都表现为一次 Promise rejection，而不是一次同步抛出。该方法保留了一层嵌套的 `try`/`catch`，手动返回 `Promise.resolve(artifact)`/`Promise.reject(...)`，而不是依赖 `async` 的自动包装。

**`chart.ts` → `artifact-file.ts`。** `resolveArtifactFile`、`validateArtifactPathSyntax`、`listArtifactEntries` 以及诊断清单相关的辅助函数，此前只为 `commitChart` "在一个 run 的 artifact 目录内解析一个具名文件" 的需求而存在；annotate_artifact 从不解析文件，因此它们随之一并删除。只有 `walkArtifactFiles`/`readBoundedFile`(捕获自身的依赖)保留了下来，位于一个重命名后的文件里，其 docstring 也不再描述与 chart 相关的行为。两个随之失去消费者的 Config 字段，`artifactDiagnosticMaxEntries`/`artifactDiagnosticMaxBytes`，已从 `config.ts`、其 schema、`resolveConfig` 以及 Runtime 的私有字段中移除。

**`science-session/src/transition.ts` 中基于策展 origin 的 tool 名 allowlist**(`requireToolCall(..., ['save_chart'])`)变为 `['annotate_artifact']`——这是随工具改名而必须改动的唯一一处持久化模型层面代码，因为一个 `origin: 'model'` 的 `science/artifact-saved` 事件，只有在其命名当前的策展工具时才合法。

**工具层面**(`tool-science`)：`save-chart.ts`/`chart-schema.ts` 被 `annotate-artifact.ts`/`artifact-schema.ts` 取代。`scienceArtifactSchemaProperties` 把 `chartId` 改名为 `artifactId`、新增 `origin`，并拓宽为两个 value builder 共享的完整字段集(`mediaType`/`bytes`/`width`/`height`/`createdAt`)，与持久化字段名保持一致。`artifact-schema.ts` 还导出了 `scienceArtifactValueFields`——两个 value builder 共同依赖的身份/策展/来源/媒体展平函数：`artifactReceiptFromArtifact`(`annotate-artifact.ts`)在其上展开、再追加自己的末尾字段(`attachmentId`/`attachmentName`)；`stateArtifact`(`state.ts`)则改为对其解构后重新拼装字段顺序，因为该处已固定的 schema 把 `environmentRevision`/`environmentFingerprintPreview` 插在 `runId` 与 `mediaType` 之间——这是一次末尾展开无法达到的位置。`get_science_state` 的 `stateChartSchema`/`charts` 变为 `stateArtifactSchema`/`artifacts`；`width`/`height` 变为可选(只在图片附件时出现)；本工具此前用来收窄为仅图片的 `hasImageAttachment` 过滤器被移除——现在无论媒体类型如何，每个被捕获/策展的 artifact 都会被列出。`history.chartVersionsOmitted` 改名为 `artifactVersionsOmitted`。

**Run 结果捕获回执。** `runOutputSchema` 新增 `capturedArtifacts`(artifactId/logicalName/version/mediaType/bytes/可选 width+height)、`captureSkippedOversizedCount`、`captureTruncatedPerRun`、`captureTruncatedPerSession`——只在 `ScienceRunResult.capture` 存在时出现(即同步/quiescent 的 settlement 路径)。`formatRunResult` 单纯从这些 schema 字段派生出一行结尾的 `` Captured N artifacts: `name` vV (mediaType[, WxH], size), ... ``，以及每个非零 skip/truncation 标记各一行——从不重新实时读取 session——因此该回执文本不会偏离它所描述的那些 `science/artifact-saved` 事件。

**`annotate_artifact` 的 presentation 暂时仍只覆盖图片。** `presentation.ts` 的 `scienceArtifactPresentation`(由 `scienceChartPresentation` 改名而来)在被策展附件带有 `width`/`height` 时，仍只投射既有的、要求图片的 Client 卡片形状 `ScienceChartPresentation`；策展一个非图片 artifact 会返回 `null`，而 `ScienceChartRow.tsx` 既有的 `parsePresentation` 早已把它当作"无卡片，回退到纯文本行"处理。这是一个刻意的过渡选择：`null` 正是为无法识别的 presentation 值早已构建好的优雅降级，而不是一种新的失败模式。`ScienceChartPresentation` 自身的 docstring 现在明确说明了这一点。[per-media-type artifact viewer rendering (csv/json/md/png)](2026-08-19-science-viewer-file-types.zh.md) 会泛化 `ui-science` 的分类型渲染，并把 `ScienceChartPresentation` 改名为 `ScienceArtifactPresentation`。

## 考虑过的替代方案

**把 `commitChart` 的错误码/诊断机制作为不可达代码保留，以备将来的改动再次需要文件解析。** 已拒绝：目前没有任何代码调用它，而 pre-release 阶段的立场更倾向于删除死代码，而不是投机性地保留——将来的改动可以针对届时真实的需求重新引入一个文件解析辅助函数。

**在这里就把 `ScienceChartPresentation` 泛化为 `ScienceArtifactPresentation`。** 已拒绝：`ui-science` 是本决策不涉及的独立包；[per-media-type artifact viewer rendering (csv/json/md/png)](2026-08-19-science-viewer-file-types.zh.md) 拥有 presentation 改名与分类型 dispatch。对非图片策展返回 `null` 是一个正确的、可用的过渡状态——而不是一个半成品类型。

**让 `annotate_artifact` 的回执计数在 `render()` 内部从 session 日志实时重新派生。** 已拒绝：`render()` 只能拿到该工具自身已持久化的 `value`，若要在那里从 `session.events` 重新派生，需要把 session 接入一个原本纯粹的投影函数。由 schema 携带这些字段(与 `chartReceiptSchema`/`stateChartSchema` 已有的模式一致)才能让 `render` 保持为 `value` 的纯函数。

## 影响

**真实 Conda 验收**(`science-runtime/tests/real-acceptance.ts`)不再调用 `commitChart` 来产出其 PNG artifact：run 本身早已把 `real-chart.png` 写入 `SCIENCE_ARTIFACT_DIR`，因此自动捕获会产出版本 1，验收脚本改为调用 `annotateArtifact` 把它策展为版本 2，再执行既有的附件回读与 Outcome 引用检查。

**`apps/web/tests/science-preset.snapshot.ts`** 现在驱动与 keyless snapshot 相同的、写出 csv/json/md/png 的 `FakeSubprocess` 模式，对 run 结果的 `capturedArtifacts` 做断言，并用 `annotate_artifact` 取代了原来的两次 `save_chart` 调用(连续版本号这一点，改为通过对同一个自动捕获的 artifact 做两次策展调用来证明，而不是两次导入)。它的 `get_science_state` 断言顺带修复了一处潜藏的 `chartCount`/`chartVersionCount` 命名 bug——自 [`science/artifact-saved` replaces `science/chart-saved`](2026-08-18-science-artifact-saved-event.zh.md) 起，持久化的 `ScienceProjectionMetrics` 字段就已经是 `artifactCount`/`artifactVersionCount`，因此旧断言的字段名从未真正匹配过该工具实际输出的 JSON。

**Keyless snapshot**(`examples/headless-agent/science-tools.cordis.snapshot.yml` 及其 driver)：`science-runtime-fixture.ts` 的 `FakeSubprocess` 现在每次 run 都会写出 `summary.csv`/`meta.json`/`notes.md`/`plot.png`(每种被自动捕获 allowlist 覆盖的媒体类型各一个文件)；`science-mock-llm.ts` 驱动 `get_science_state` → `run_python` → `annotate_artifact` → `publish_outcome` → `get_science_state`，断言五个 `science/artifact-saved` 事件(四个自动、一个策展、四个不同的 artifact 身份)，取代了此前对同一身份的两次 `save_chart` 调用。`model-view.expected.json`/`stream-json.expected.jsonl` 已用 `DSH_SNAPSHOT=refresh` 重新生成(keyless——不需要 API key，因为该场景的模型是一个脚本化的确定性 adapter)，并已在普通 replay 下复核为稳定。

**测试覆盖。** `science-runtime/tests/annotate.spec.ts`(新文件)：策展最新版本并复用附件/溯源、一个非图片 artifact、一个精确命名的(非最新)版本、一条策展链、一个未知 `logical_name`、以及一个未知 `version`(诊断信息中带有可用版本列表)。`science-runtime/tests/artifact-file.spec.ts`(由 `chart.spec.ts` 改名而来，只保留幸存的两个导出)：遍历顺序、symlink 排除、硬性遍历上限，以及包含精确边界情形的有界读取行为。`tool-science/tests/tool-science.spec.ts` 的 `save_chart` describe block 变为 `annotate_artifact`，直接(通过一次真实的 `ctx.attachments.saveImage`/`saveText` 调用，加上一个手工构造的 `origin: 'auto'` 事件，因为本地的 `FakeSubprocess` fixture 从不写出真实文件)播种自动捕获的 artifact，而不再经由 `writeArtifact`+`save_chart`。每一个被改动的 `src/` 文件都保持逐文件 100% 覆盖率。

**推迟到、并由 [per-media-type artifact viewer rendering (csv/json/md/png)](2026-08-19-science-viewer-file-types.zh.md) 收尾**：`ui-science` 中 `ScienceDetailsView.tsx`/`ScienceOutcomeRow.tsx` 的 `hasImageAttachment` 过滤器、`ScienceChartRow.tsx` 的 toolview key(`save_chart`，因不再存在同名工具而不可达——死代码但仍可编译，对用户不可见，因为不会发生任何 `save_chart` 工具调用)，以及 `ScienceChartPresentation` → `ScienceArtifactPresentation` 的改名，都一直保持 [Science Runtime auto-capture of run-written files](2026-08-19-science-auto-capture.zh.md) 落地时的原样，直到那篇笔记把 viewer 泛化到每种被捕获的媒体类型，并把会话记录行重新以 `run_python`/`run_r`/`annotate_artifact` 为键注册为止。
