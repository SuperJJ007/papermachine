# Agent Note: Project artifact store — S3 跨 session 延续

Status: implemented

[English](2026-08-26-project-artifact-store-s3.md) | 中文

## 问题

[S1](2026-08-26-project-artifact-store-s1.zh.md) 交付了 project artifact store 包；[S2](2026-08-26-project-artifact-store-s2.zh.md) 把 `science-runtime`/`science-session`/`tool-science` 接上了它，但每一次捕获、策展与 run input 引用仍然只对照发起操作的那个 session 自身的实时 projection 或 fold 本地历史来解析——即便 store 本身(S1)早已按 project 而非按 session 建立 artifact 索引，同一 project 下开启的第二个 Science session 也无法接续、引用或扩展第一个 session 已经产出的 artifact。[S0](2026-08-25-project-artifact-store.zh.md) 把这定为 spec 第 5 条:同一 project 中第二个 session 读取、引用并追加第一个 session 的 artifact 的新版本，artifact identity 不变，新版本的 producer 记为新 session。

## 决定

**自动捕获在判断创建还是追加时,不只看该 session 自身的 fold,还会查询 project store。** `captureRunArtifacts`(`science-runtime/src/capture.ts`)仍然优先使用该 session 自身的实时 projection——绝大多数遍历重新捕获的都是该 session 自己已经知道的路径,这种情况不需要额外查询 store。只有当被捕获路径的逻辑名在本地没有任何记录时,遍历才会调用 `store.listArtifacts(projectId)`(每次遍历只惰性获取一次,并缓存)去检查同一 project 中是否已有另一个 session 拥有这个逻辑名。若在 store 中找到,就沿用其既有 `artifactId`——新版本的 producer 记为当前 session,其内容会像同一 session 内重跑一样,对照该 artifact 跨 session 的 latest 去重——而不是在同一名字下分叉出第二个 artifact。针对直接人工编辑自身祖先链的去重仍只限定在该 session 自身的本地历史内;当前没有任何验收路径要求把这一项也扩展到项目全量历史。这一机制曾被短暂删除(`b0524e2c64`),后被 [runtime provenance-writes note](2026-09-02-science-runtime-provenance-writes.zh.md) 恢复,并顺带补上了创建竞态的处理;本段在设计层面的描述依旧准确,该 note 拥有当前 store 读取细节的权威(`store.getLatestVersion`/`store.listVersions` 取代了 session 自身经瘦身后的 projection,这是 T1/T2 的 artifact 权威迁移带来的必然变化)。

**`artifactInputs`(`run_python`/`run_r`)会解析跨 session 引用,`editBaselines` 不会。** `prepareRunArtifacts`(`science-runtime/src/inputs.ts`)先对照该 session 自身的实时 projection 解析每个 input;未命中时,回退到 `store.listVersions(projectId, artifactId)` 并按 ordinal 匹配——对于另一个 session 产出的 artifact,store 是该 session 自身 projection 永远无法独立重建的权威来源。`editBaselines` 仍保持只按该 session 本地解析:要扩展它,还需要 `science-session` 的 fold 在 replay 时也接受一个无法本地解析的 `parent` 引用,而人工编辑不变量(parent 的 logical name、media type、environment provenance 是否一致)在没有该版本本地副本的情况下无法校验——这是一个尚未有人设计评审过的真实课题,超出本切片范围(spec 第 5 条谈的是 artifact 的读取/引用/追加,不是血缘)。

**严格 fold 会信任一个自己无法独立验证的跨 session 引用,而不是拒绝它。** `science-session/src/transition.ts` 中原有两处检查都假定每一个 artifact 引用都能从该 session 自身累积的 fold 状态中解析出来——这个假设在 S3 之前始终成立,因为在那之前每一个引用本来就确实如此。验收规则是相对于该 session 自身对该 artifactId 已记录的本地最高版本而言的:严格高于该最高版本的引用会被信任,因为 store 自身的事务在该引用事件提交之前就已经证明它是真实的——这既覆盖该 session 从未记录过该 artifactId 的情形,也覆盖该 session 只记录到某个较低版本的情形(并发的另一个 session 自己交错的追加可能占用了中间的若干 ordinal)。落在该本地最高版本之内(等于或低于它)的引用,仅凭 log 就能完全校验,永远不会被交给 store 去信任:
- `applyArtifactSaved` 的版本检查接受任何严格高于该 session 自身 fold 已为该 artifactId 记录过的最高版本的版本号——无论该 session 从未记录过该 artifactId(最高版本不存在,因此 codec 自身 `POSITIVE_INTEGER` schema 许可的任意正数 ordinal 都合格),还是已经记录过若干版本、而这一次落在它们之外。一个等于或低于该本地最高版本、又和某个本地记录不完全匹配的版本号,属于仅凭 log 就能验证的同 session 内不一致,仍会抛错。
- `applyRunStarted` 的 run input 检查(`requireRunInputArtifactVersion`,替换了这一处原本共用的 `requireArtifactVersion`)遵循完全相同的规则:当所引用的版本号超过该 session 自身对该 artifactId 已记录的本地最高版本时(包括该 session 根本没有任何本地记录的情形)直接返回、不抛错;只有当所引用的版本号等于或低于该最高版本、且与某个本地记录不完全匹配时才会抛错。

这两处放宽都是在信任一个实时 Runtime 已经在该引用事件提交之前对照 store 校验过的事实(S0 所规定的 Host 侧 pre-commit invariant);纯粹的 fold replay 永远不会触达 store,因此它选择沿用这个已经校验过的事实,而不是重新推导它。`artifact.parent` 的解析(`requireArtifactVersion`,同时被 parent 自引用检查与人工编辑不变量使用)未作改动,仍然严格——因为上文的 `editBaselines` 解析仍只限于同一 session,今天没有任何调用方能够产出一个合法的跨 session `parent`。

**Files 列表本来就是 store 层面已有的事实,不是新机制。** S1 的 `listArtifacts(projectId)` 已经为每个 artifact 只返回一行,`latestVersionId` 指向无论由哪个 session 产出的当前版本——S3 没有新增任何列表 API。S3 真正改变的是捕获自身"创建还是追加"的判断(见上文):在本切片之前,第二个 session 对一个已存在逻辑名的重新捕获会调用 `createArtifact`,为同一个名字产出第二行——因为捕获此前只会去问该 session 自己的 fold。一个专门的 `science-runtime` 测试证明,跨 session 接续之后 store 依然只显示一行,且该 latest 版本的 producer 是新 session——这正是 spec 第 5 条"Files 仍显示一个 Artifact/latest"在 store 层面所归约成的事实。作为 UI 层面呈现的 Files 界面(`ProjectLibrary`,`packages/client/ui-science`)现在直接渲染同一份"每 artifact 一行"的列表,读取路径是 `sessions.scienceLibrary`/`scienceVersions`。

**Host 重启后仍会继续写入同一个磁盘 store。** 没有新机制:`ScienceArtifactStore.openProject` 早已根据 `dshHome`+`projectId` 确定性地推导出某个 project 的 store 路径(S1),因此一个指向同一 `dshHome` 的全新 Cordis Context 会重新打开同一个磁盘索引与 blob。一个专门测试在第一个 session 完成捕获后 dispose 掉一个 harness 的 Context,再针对同一个 `dshHome` 创建第二个、完全独立的 harness(全新 Context、全新 `ScienceArtifactStore`、全新 `ScienceRuntime`),证明第二个 session 的接续不携带任何内存态——只依赖已经持久提交的内容。

## 已考虑的替代方案

**在本切片中也把 `editBaselines`/parent 血缘扩展到跨 session** — 已否决:这需要 `science-session` 的 fold 在 replay 时也像 run input 那样接受一个无法本地解析的 `parent`,但消费该已解析 parent 的人工编辑不变量(logical name、media type、environment provenance 是否一致)在 parent 只是一个裸引用、没有本地副本可供校验时没有退路。让 fold 去信任一整套自己无法校验的转发 artifact 元数据,与信任 run input 那种单字段"这个引用存在"的事实相比,是一个实质更大、性质不同的信任边界,在这里没有被设计或评审过。

**彻底把捕获的创建/追加判断改为完全依赖 store**(去掉 session 本地的快路径) — 已否决:该 session 自身的实时 projection 已经能以零 I/O 的方式正确回答"这个逻辑名是否已有 artifact",只要文件是这个 SESSION 自己此前某次 run 捕获的;为了正确处理更罕见的跨 session 情形而放弃这条路径、让每个被捕获文件都去查一次 store,只会拖慢占绝大多数的常见情形(单 session 反复运行)。

**做一个专门的 project 级"Files"列表工具或 RPC** — 已否决：store 既有的 `listArtifacts`/`getVersion`（S1）已经完整回答了"每个 artifact 一行、latest 版本"这个问题。后续的 [Session 鉴权读取路径](2026-08-26-session-authorized-science-artifact-reads.zh.md)恢复了浏览器端确切版本的内容读取，但没有增加这个独立范围的 project 全量呈现。

## 后果

`science-runtime` 的自动捕获遍历与 `prepareRunArtifacts` 现在除了 S2 已经使用的读写方法外,还依赖 `ScienceArtifactStore.listArtifacts`/`listVersions`;store 没有任何公开方法签名发生变化。`science-session` 的严格 fold 现在只接受一个更窄的、此前会被拒绝的 `science/run-started`/`science/artifact-saved` 值子集——一个等于或低于该 session 自身对某 artifactId 已记录的本地最高版本、又与某个本地记录不完全匹配的引用,仍然照旧被拒绝;而一个严格高于该本地最高版本的引用现在会被接受,无论该 session 自身的 fold 此前是否记录过这个 artifactId 的任何版本。`packages/science/science-session/tests/fold.spec.ts`、`fold-transitions.spec.ts` 与 `invariant.spec.ts` 覆盖了两个方向:接受高于本地最高版本的引用(包括并发 session 交错追加留下的跳跃,不只是紧邻的下一个 ordinal),以及拒绝落在已知范围内但不匹配的引用;`science-runtime/tests/capture.spec.ts` 通过两个针对同一个真实 project store 真正交错的 session,端到端证明了同一条规则。

`editBaselines`/parent 血缘、人工编辑接续与 `annotate_artifact` 策展目前仍只能对照发起操作的 session 自身的 fold 本地历史解析——对这些路径而言，指名另一个 session 产出的版本仍会被拒绝。浏览器内容读取现在使用后续的 Session 鉴权确切版本 RPC；真正的 project 级"Files" UI（与 session 会话内出现的记录区分开、单独列出该 project 全部 artifact 的板块）仍不属于这项机制。本切片没有新增 keyless ACP/headless snapshot 场景：面向工具的 schema（`run_python`/`run_r` 的 `artifact_inputs`、`get_science_state`）与切片之前逐字节一致——改变的是哪些此前会被拒绝的调用现在会成功，这一点通过真实的、以 `ctx.plugin` 组装的 `science-runtime` 测试（真实 `ScienceArtifactStore`、真实 session，新增覆盖中没有 mock store）得到验证，而不是一个新的多 session headless-agent 场景——后者需要新的 fixture 脚手架才能在一个录制示例里表达两个 session，这里作为留给下一个扩展 headless-agent 示例套件的人的缺口标出，并未在本切片预算内修复。

`packages/science/science-session/src/applicability.ts` 与 `transition.ts` 目前均为按文件 100% 覆盖率。
