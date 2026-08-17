# @deepseek-ai/dsh-science-runtime

[English](README.md) | 中文

`@deepseek-ai/dsh-science-runtime` 提供折叠的、host-local 的 Conda Science Runtime，用于持久化 environment、run 与 chart 事实。它拥有 `ctx.scienceRuntime`、按 Session 隔离的私有 scratch、Python/R direct argv 构造、稳定 prefix 观测、精确 Session lease、终态结果分类，以及把 PNG 导入附件存储的能力。它不注册面向模型的工具、提示词、preset 或 UI。

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

`profiles` 是由 `ScienceEnvironmentProfileId` 键控的非空 closed map；每个值至少有一个 absolute `pythonPrefix` 或 `rPrefix`。`timeoutMs` 默认是 120,000，且只接受 1 至 600,000 的 safe integer。

## 操作

`bindEnvironment({ session, profileId, signal })` 要求精确的 live Science Session object，观测所选 profile，并追加一个完整的 `science/environment-bound` 值。静态缺失或不可用的 interpreter 会成为 `invalid` 值；取消、超时、prefix I/O 失败、partial confinement 或可写 root 重叠会拒绝且不追加 environment event。

`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })` 会重新观测 applied binding，把未改变的 UTF-8 source 写入私有 run directory，追加 `science/run-started`，并返回 `ScienceRunHandle`。该 handle 只暴露 `runId`、`done` 和幂等的 `cancel()`；它不暴露 PID 或 Host scratch path。它解析出的 result 包含已提交的 terminal record、受限的运行期 stdout/stderr tail、精确 byte count 与截断事实。output text 永不进入 Science Session event。

`commitChart({ session, runId, artifactPath, logicalName, title, caption, toolCallId, requestHeaderSeq, signal })` 只接受由精确 Session 本地启动且已成功的 run，并只解析该 run 私有 `SCIENCE_ARTIFACT_DIR` 下的普通非 symlink PNG；读取上限是附件存储字节上限加一。`ctx.attachments.saveImage` 仍是媒体接纳权威。Runtime 先持久化附件，再追加完整的 `science/chart-saved` 版本；同一逻辑名的连续版本共用稳定 chart id，且不会公开 Host path。

Runtime 对发布前的误用或能力失败以 `ScienceRuntimeError` 拒绝。start event 提交后，普通 process、runner、denial、取消与超时 outcome 都会追加一个匹配的 terminal event。如果有界结算无法证明整棵 process tree 静止，`done` 会拒绝，但 Runtime 会保留 lease；后续 positive proof 会先向 still-live Session 追加 terminal fact，再释放 lease，而 false 或 rejected proof 会继续保持 quarantine。still-live Session 不能提交 terminal fact，或意外 detached Session 使提交被禁止时，`done` 也会拒绝。

## 限制与环境

每次 probe 和 run 都使用 direct argv、空 subprocess environment base、固定 environment allowlist、owned cwd 和 full `workspace-write` confinement。Python probe 使用 `-I -B -X utf8`，run 额外使用 `-u`。R 版本发现仅使用 `Rscript --version`；UTF-8 probe 和 run 使用 `Rscript --vanilla --encoding=UTF-8`。Runtime 拒绝与任何 writable root 重叠的 Conda prefix，且绝不把项目目录授予为 workspace。

私有 root 派生在 `DSH_HOME/science/v1/` 下，包含独占的 mode-0600 owner marker 与 mode-0700 directory。只有独占 marker 创建成功的 operation 才取得 rollback ownership；materialization 失败时，会在校验 marker bytes 后删除该 operation 的精确 marker 与 Session root，而并发或既有 ownership 会被保留。live operation 保留精确的 Session object；相同 ID 的 successor 在较早 detached lifecycle 证明所有 owned tree 已静止前保持 quarantine。已接受的 run directory 会保留用于 state 和诊断；未发布的 probe directory 只有在静止后才移除。

## 验证

fake-prefix 测试覆盖 Python-only、R-only、shared 与 distinct prefix；严格配置；稳定与漂移观测；无效 UTF-8 probe byte；scratch ownership；direct argv；空环境；output 上限；terminal 分类；取消；超时；detachment；同 ID quarantine；Loader 组合；以及 live/cold replay。只用 lstat 的 prefix manifest 记录相对路径、类型、symlink target、mode、size、mtime/ctime nanoseconds 与 regular-file digest，且不使用 atime；前后 diff 为空才表示 prefix 未改变。

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
