# Agent Note: Science Runtime 物化 artifact input 并指定 edit baseline

Status: implemented

[English](2026-08-22-science-runtime-input-materialization-and-edit-baselines.md) | 中文

## Problem

Science Session schema 已能记录 artifact 祖先关系与 run 依赖，但 Runtime 无法产生这两类关系。run 无法从私有 scratch 消费精确的既有 artifact version，自动捕获也无法区分普通新版本与从显式较旧或跨 artifact baseline 派生的内容。

更广泛的 [artifact domain 与 image edit 提案](../../proposed/architecture/2026-08-22-science-artifact-domain-and-image-edit.zh.md)要求这些操作先于面向模型的工具开放 image edit。[Session schema 决策](../architecture/2026-08-22-science-artifact-lineage-and-run-input-schema.zh.md)仍是持久化校验权威。

## Decision

`ScienceRuntime.startRun` 接受可选的 `artifactInputs` 与 `editBaselines`。每项 input 命名一个已提交的 `{artifactId, version}` 和一个使用正斜线的相对路径。在 `science/run-started` 之前，Runtime 从实时严格 projection 解析每个版本，通过提供方带校验和的 `readImage` 或 `readText` 路径读取其附件，把经过校验的字节写到未发布 run 保留的 `inputs/` 目录下，并在 start fact 上记录完整有序映射。terminal fact 通过 `ScienceRunIdentity` 原样重复该映射。

input path 会拒绝空值、点、父级、反斜线、NUL、异常 Unicode、重复、大小写折叠、规范化等价及文件与目录之间的碰撞。`inputMaxFilesPerRun` 与 `inputMaxBytesPerRun` 在发布前作用于完整的请求 input 集；聚合字节上限会同时对照持久化附件元数据与经过校验的字节。缺失版本以 `INPUT_NOT_FOUND` 拒绝，不安全路径以 `INPUT_PATH_INVALID` 拒绝，数量或字节超限以 `INPUT_TOO_LARGE` 拒绝。每次拒绝都不会留下已发布 run 或保留的未发布 run 目录。

保留的 `inputs/` 目录是 `artifacts/` 的同级目录，绝不位于 `SCIENCE_ARTIFACT_DIR` 内，因此物化的证据不会被捕获成新 output。持久化 kernel protocol 保持版本 1：既有 run cwd 使 `inputs/...` 可直接读取，无需新增 frame 字段或 kernel helper。

每个 `editBaselines` 键都是经过校验的 capture-relative output path，其值是一个已提交的 artifact version。Runtime 会在发布前复制并校验该 map，随后保留至 terminal 之后的捕获遍历。匹配的 output 会携带该精确引用作为 `parent`；output path 仍决定 logical artifact 身份与版本推进。既有名称推进自身 artifact，新名称创建跨 artifact 分支，较旧 baseline 仍以陈旧分支可见。未匹配的 output 没有 parent，字节级相同的 output 仍会跳过。缺失 baseline 以 `ARTIFACT_NOT_FOUND` 拒绝。

捕获图片继续使用附件提供方的 verbatim 接纳路径。因此 input 读取会恢复捕获时提交的字节级精确证据对象，而 model-request image projection 仍可另外派生按 route 规范化的字节。

## Alternatives considered

**把附件存储路径传给 kernel。** attachment id 是提供方无关引用，不是 Host path；公开提供方存储会绕过经过校验的读取，并把 Runtime 耦合到单一后端。

**把 input 放进 `SCIENCE_ARTIFACT_DIR`。** 捕获遍历会把已消费证据当成新产生的 output，形成虚假版本与依赖环。

**从 output 名称或 latest version 推断 edit 祖先关系。** 重命名的 output 可能分支成新 artifact，edit 也可能有意从较旧版本派生。只有调用方的精确 baseline 能保留这些事实。

**用 input 与 baseline 字段扩展 kernel protocol。** Host 已经在 `RUN` 之前拥有 run directory，并在 `DONE` 之后拥有捕获遍历。扩展两个 kernel driver 会增加协议状态，却不会赋予 Host 尚不具备的权威或行为。

**为 input 复用自动捕获上限。** 捕获上限控制 terminal 提交后的 best-effort 产出；input 上限控制发布前 all-or-nothing 的依赖物化。两者具有不同的失败时点与部署成本。

## Consequences

Runtime 调用方可以针对精确既有证据执行，并在 Session log 中记录依赖，而无需公开附件存储或 Host path。捕获祖先关系会保留既有名称 edit、跨 artifact 分支与陈旧 baseline，且不改变 artifact 版本顺序。

面向模型的 `run_python` 与 `run_r` schema 仍未开放这些字段；该 Consumer 工作、receipt 与 assembled-app snapshot 属于下一个工具切片。物化 input 会按既有保留策略随已接纳的 run scratch 一并保留。

## Testing

`science-runtime` 测试套件会针对 fake kernel protocol 执行真实 Runtime 与本地附件提供方。覆盖精确字节 input 落位、完整 start/terminal 映射、精确及超出聚合字节上限、无法解析的版本、路径逃逸与祖先碰撞、既有名称推进、跨 artifact 分支及陈旧 baseline 祖先关系。配置测试固定两个新上限及其可接受极值。
