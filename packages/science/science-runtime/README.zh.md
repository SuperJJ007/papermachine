# @deepseek-ai/dsh-science-runtime

[English](README.md) | 中文

`@deepseek-ai/dsh-science-runtime` 提供折叠的、host-local 的 Conda Science Runtime，用于持久化 environment、run 与 artifact 事实。它拥有 `ctx.scienceRuntime`、按 Session 隔离的私有 scratch、Python/R direct argv 构造、稳定 prefix 观测、精确 Session lease、终态结果分类、把 run 写出的文件自动捕获为带版本的 artifact，以及把已挑选的 PNG 导入附件存储的能力。它不注册面向模型的工具、提示词、preset 或 UI。

## 组装

在 Host 加载 `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-science-session`、`@deepseek-ai/dsh-attachment-local`、`@deepseek-ai/dsh-subprocess-local`、`@deepseek-ai/dsh-sandbox-local` 和本包；在准入 Science Session fact 的组合中选择 `@deepseek-ai/dsh-science-session/invariant`。Runtime 要求附件 provider、`host-local` subprocess provider 和报告 full enforcement 的 sandbox provider。它的 `./invariant` 配套模块不重复事件关系，因为 Science Session invariant 负责 durable stream 校验。

包配置只命名现有的 absolute Conda prefix。它不调用 Conda，也不创建、克隆、更新、安装到、修复或删除 prefix。

```yaml
- name: '@deepseek-ai/dsh-science-runtime'
  config:
    dshHome: /absolute/test-owned/dsh-home
    timeoutMs: 120000
    profiles:
      analysis:
        pythonPrefix: /absolute/conda/python
        rPrefix: /absolute/conda/r
```

`profiles` 是由 `ScienceEnvironmentProfileId` 键控的 closed map。空 map 是合法的显式未配置状态；每个已声明的值仍至少有一个 absolute `pythonPrefix` 或 `rPrefix`。`timeoutMs` 默认是 120,000，且只接受 1 至 600,000 的 safe integer。`packagesMaxEntries`（默认 2,000；1 至 20,000）与 `packagesMaxBytes`（默认 65,536；1,024 至 1,048,576）限定每个已观测 interpreter 保留的 package inventory，详见下方“操作”一节。`captureMaxFileBytes`（默认 5 MiB；1 至 50 MiB）、`captureMaxFilesPerRun`（默认 50；1 至 1,000）与 `captureMaxArtifactVersionsPerSession`（默认 500；1 至 10,000）限定自动捕获，详见下方“自动捕获”一节。

## 绑定 settings 的入口

`@deepseek-ai/dsh-science-runtime/with-settings` 以同一份 `Config` 提供同一个 service，并额外通过 restart-scoped `science-runtime` user-settings namespace 解析 `profiles`，该 namespace 只保存这张 map。Cordis `profiles` map 是它的 composition `base`。Runtime 在 load 时对解析后的 map 做一次快照，并且不 watch，因此一次成功 write 只影响下一次 Host start。`pythonPrefix` 与 `rPrefix` 在每份面向浏览器的 settings descriptor 上都是只写 secret。

该入口把 `settings` 声明在自己的 injection 中，这正是解析顺序得以固定的原因：Cordis 只在 settings provider 处于 ACTIVE 后才构造它。若某个 composition 挂载了它却没有 settings provider，它会因未满足的 injection 停在 PENDING。仅凭配置拥有自己 profile map 的 deployment 挂载根入口，根入口永不读取 settings。

两个入口提供的是同一个 `ctx.scienceRuntime` Cordis service，而该 service 只持有一个 provider：二者是互斥的替代关系，不会同时挂载。已发布的 Web bundle 默认在 Cordis entry id `science-runtime` 下挂载 `with-settings`；若某个 deployment 改为仅凭 Cordis 配置拥有自己的 profile map，应按 id 覆盖该行（与其它 bundle 行覆盖方式一致的 patch 替换），而不是 `insert` 第二个 Runtime 行——插入第二行会在 load 时抛出 `service "scienceRuntime" has been registered`。

## 操作

`bindEnvironment({ session, profileId, signal })` 要求精确的 live Science Session object，观测所选 profile，并追加一个完整的 `science/environment-bound` 值。静态缺失或不可用的 interpreter 会成为 `invalid` 值；取消、超时、prefix I/O 失败、partial confinement 或可写 root 重叠会拒绝且不追加 environment event。每个可用 interpreter 的 identity 还携带一份 package inventory：对完整观测结果排序并计算 digest 后的 name/version pair，再按 `packagesMaxEntries`/`packagesMaxBytes` 截留；超出任一上限都会截断保留列表并置位 `packagesTruncated`，而 digest 仍覆盖截断前的完整 inventory。若 package-inventory probe 未产生可解析的输出，整个 interpreter 观测会成为 `invalid`，与 version 和 UTF-8 probe 的诚实失败行为一致。

`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })` 会重新观测 applied binding，把未改变的 UTF-8 source 写入私有 run directory，追加 `science/run-started`，并返回 `ScienceRunHandle`。该 handle 只暴露 `runId`、`done` 和幂等的 `cancel()`；它不暴露 PID 或 Host scratch path。它解析出的 result 包含已提交的 terminal record、受限的运行期 stdout/stderr tail、精确 byte count 与截断事实。output text 永不进入 Science Session event。

### 自动捕获

每个 run 的 terminal fact 一旦提交——无论 success、failed、timed-out 还是 cancelled——Runtime 会立即遍历该 run 私有的 `SCIENCE_ARTIFACT_DIR`，把每个合格文件按其相对该目录的路径（`plots/loss.png`、`summary.csv`）持久保存为对应逻辑 artifact 的下一个版本。合格是指：路径任一 segment 都不是 dotfile 或 dot-directory，且小写扩展名属于固定 allowlist `.csv`、`.json`、`.md`、`.png`、`.txt`——这份文件格式 allowlist 与附件存储自身固定的 `mediaTypes` 集合一致，不是 Loader 可配置项。被捕获的版本带有 `origin: 'auto'`，标题等于文件的 basename；内容寻址使接纳具有幂等性,因此同一逻辑名的字节级相同重跑会被静默跳过，不会提交多余版本。

`captureMaxFileBytes` 限定单个文件的可接纳大小(超限文件会被跳过并计数，绝不导致 run 失败——包括部署方附件上限比该值更小的情形)。`captureMaxFilesPerRun` 限定单次 run 尝试的合格文件数；超出的部分会被截断(不予尝试)并在返回的统计中标记。`captureMaxArtifactVersionsPerSession` 限定一个 session 通过自动捕获在所有 run 之间累积的 artifact 版本数；一旦达到，自动捕获会在该 run 剩余部分及此后的每个 run 中停止追加新版本并做出标记，直到未来的保留策略回收空间为止。捕获失败——无论是超限文件、触发上限，还是意外异常——都绝不会使已经提交了 terminal fact 的 run 失败。

`commitChart({ session, runId, artifactPath, logicalName, title, caption, toolCallId, requestHeaderSeq, signal })` 只接受由精确 Session 本地启动且已成功的 run，并只解析该 run 私有 `SCIENCE_ARTIFACT_DIR` 下的普通非 symlink PNG；读取上限是附件存储字节上限加一。`ctx.attachments.saveImage` 仍是媒体接纳权威。Runtime 先持久化附件，再追加带有 `origin: 'model'` 的完整 `science/artifact-saved` 版本；同一逻辑名的连续版本共用稳定 artifact id，且不会公开 Host path。

Runtime 对发布前的误用或能力失败以 `ScienceRuntimeError` 拒绝。start event 提交后，普通 process、runner、denial、取消与超时 outcome 都会追加一个匹配的 terminal event，紧接着就是上文的自动捕获遍历。如果有界结算无法证明整棵 process tree 静止，`done` 会拒绝，但 Runtime 会保留 lease；后续 positive proof 会先向 still-live Session 追加 terminal fact、运行它自己的自动捕获遍历，再释放 lease，而 false 或 rejected proof 会继续保持 quarantine。still-live Session 不能提交 terminal fact，或意外 detached Session 使提交被禁止时，`done` 也会拒绝。

## 限制与环境

每次 probe 和 run 都使用 direct argv、空 subprocess environment base、固定 environment allowlist、owned cwd 和 full `workspace-write` confinement。Python probe 使用 `-I -B -X utf8`，run 额外使用 `-u`；其 package-inventory probe 追加 `-m pip list --format=json`，报告 interpreter 自身所见。R 版本发现仅使用 `Rscript --version`；UTF-8 probe 和 run 使用 `Rscript --vanilla --encoding=UTF-8`；其 package-inventory probe 求值 `installed.packages()` 并以 TSV 打印 `Package`/`Version`，只使用 base R，因为无法保证 `jsonlite` 已安装。Runtime 拒绝与任何 writable root 重叠的 Conda prefix，且绝不把项目目录授予为 workspace。

私有 root 派生在 `DSH_HOME/science/v1/` 下，包含独占的 mode-0600 owner marker 与 mode-0700 directory。只有独占 marker 创建成功的 operation 才取得 rollback ownership；materialization 失败时，会在校验 marker bytes 后删除该 operation 的精确 marker 与 Session root，而并发或既有 ownership 会被保留。live operation 保留精确的 Session object；相同 ID 的 successor 在较早 detached lifecycle 证明所有 owned tree 已静止前保持 quarantine。已接受的 run directory 会保留用于 state 和诊断；未发布的 probe directory 只有在静止后才移除。

## 验证

fake-prefix 测试覆盖 Python-only、R-only、shared 与 distinct prefix；严格配置；稳定与漂移观测；无效 UTF-8 probe byte；两种语言的 package-inventory 解析、排序、entry/byte 上限截断与 probe 失败处理；scratch ownership；direct argv；空环境；output 上限；terminal 分类；取消；超时；detachment；同 ID quarantine；Loader 组合；以及 live/cold replay。一套专门的自动捕获测试覆盖新文件、变更文件、字节相同的重跑(跳过)、超限文件、per-run 与 per-session 上限、dotfile/扩展名排除、对失败 run 的捕获、部署方附件存储拒绝接纳，以及一次不致命的内部捕获失败。一个专门测试将 `bindingFingerprint` 与 package inventory 的独立性钉住：对同一静态 identity 重新绑定并观测到不同的 inventory 时，只会改变 `packagesSha256`，不会改变 `bindingFingerprint`。只用 lstat 的 prefix manifest 记录相对路径、类型、symlink target、mode、size、mtime/ctime nanoseconds 与 regular-file digest，且不使用 atime；前后 diff 为空才表示 prefix 未改变。

真实 Conda 验收独立且 opt-in。它绝不把 fake-prefix evidence 当作真实机器 evidence。

```sh
DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1 \
DSH_SCIENCE_RUNTIME_TEST_OWNED=1 \
DSH_SCIENCE_RUNTIME_DSH_HOME=/absolute/test-owned/dsh-home \
DSH_SCIENCE_RUNTIME_PYTHON_PREFIX=/absolute/conda/python \
DSH_SCIENCE_RUNTIME_R_PREFIX=/absolute/conda/r \
pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance
```

该命令分别将 Python 和 R 报告为 `PASS`、`FAIL` 或 `NOT-RUN`；缺少 opt-in 输入时为 `NOT-RUN`。每个被选择的语言会校验 canonical prefix/executable/history identity、非 ASCII direct source/output、空环境行为、owned directory、full confinement、取消、超时、prefix-write denial、managed-tree 结算与未改变的 prefix manifest。

## 模型体验

无。本 Runtime 为 `@deepseek-ai/dsh-tool-science` 提供非模型可见的操作，不注册任何提示词上下文。

#### KV Cache 影响

无；Runtime 不会组装或发送 provider request。

## 已知限制与暂缓事项

- **不管理 environment** — Runtime 消费显式指定的既有 prefix；不发现、创建、安装、更新、修复或删除 Conda environment。
- **只使用已有的本地 prefix** — observation 是 fingerprint，不是可复现环境锁；Runtime 从不管理 Conda package 或 environment。
- **仅 file-write confinement** — full sandbox enforcement 限制所述的 file write，但不宣称隔离 file read、network、syscall 或科学有效性。
- **仅 host-local execution** — remote subprocess provider 和 partial sandbox backend 会 fail closed，因为此实现拥有私有 Host scratch。
- **截断的 package inventory 无法回放为一个 environment** — digest 仍覆盖完整 inventory，因此截断是可检测的，但被截留的 name/version pair 列表不是可安装的规格说明。`bindingFingerprint` 从不纳入 package digest，因此调高或调低任一上限都不会改变 drift 检测。
- **会话中途安装的 package 在下一次绑定前不可见** — inventory 按每次 environment 绑定采集一次，而非按每次 run 采集；`condaHistorySha256` 已在那个时点捕捉 conda 层面的变更。
- **非静止分支的自动捕获没有同步的模型可见信号** — 在本 Runtime 捕获任何内容之前，非静止结算分支的最终 terminal fact 对模型当前回合就已经不可见；它自身的自动捕获遍历延续了同样的不对称。无论如何，被捕获的版本都是持久化的 `science/artifact-saved` event，模型下一次调用 `get_science_state` 时即可发现；v1 未为该分支新增单独的完成通知。
- **run 的 terminal 提交与其自动捕获遍历之间发生崩溃，会使该 run 的文件永久未被捕获** — 且没有自动重试。这与既有的 `science/run-started` 前/后 scratch 清理的不对称性相同，v1 接受此限制；未来的保留或对账流程是弥补它的接口。
- **遍历过程中(而非遍历之前)发生的自动捕获失败同样没有自动重试** — 无论是环境性故障(run 的 artifact 目录消失、权限或磁盘错误)还是本 Runtime 自身捕获逻辑中的缺陷，都会让该 run 的遍历就此停止而不导致 run 失败；该 run 自身的 terminal fact 与结果保持不变，且失败会被记录(环境性故障记为 `warn`，其他情况记为 `error`)而不是被静默吞掉，但该 run 中剩余的可捕获文件仍会保持未捕获状态，直到未来某个保留或对账流程以与上述崩溃场景相同的方式弥补这个缺口。
