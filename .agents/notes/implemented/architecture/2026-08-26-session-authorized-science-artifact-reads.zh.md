# Agent Note：Session 鉴权的 Science artifact 读取

Status: implemented

[English](2026-08-26-session-authorized-science-artifact-reads.md) | 中文

## 问题

[Project artifact store S2](2026-08-26-project-artifact-store-s2.zh.md) 从 `ScienceArtifactVersion` 移除了附件引用，但 `ui-science` 仍通过 Session 附件服务读取 artifact 字节。浏览器既无法针对当前投影编译，也无法安全读取 store blob：若接受客户端提供的 project id，请求就能选择与指定 Session 无关的鉴权域。

## 决定

`session.scienceArtifact({ sessionId, versionId })` 是浏览器读取一个不可变 Science artifact 版本的唯一途径。网关在接触 store 之前严格折叠指定 Session。若 fold 包含该已保存版本，它的 `projectId`、hash、媒体类型与字节数就是可信坐标。若 fold 证明了一个 [S3](2026-08-26-project-artifact-store-s3.zh.md) 跨 Session run input，日志只含 artifact id 与 ordinal；因此网关打开由 Session header 的持久 `cwd` 推导出的 project，列出该 artifact 的版本，并且仅在 store 行的 ordinal 与引用相符时接受请求的 version id。请求没有 project-id 字段。

`ui-science` 保留无状态图像与文本 loader 的调用形状，但两者现在都调用 `ISession.readScienceArtifact(versionId)`。图像转成 `data:` URI，文本采用严格 UTF-8 解码。project store 元数据不含附件尺寸，因此 project-store 图像使用本包自己的预览组件。这次变更恢复 Session artifact 的预览、下载、溯源、Outcome 证据与轮末缩略图；不新增 project 级 Files 列表、筛选或 RPC。

## 已考虑的替代方案

**在 `versionId` 旁接受 `projectId`** — 已否决，因为客户端会在 Session 日志鉴权之前自行选择 store namespace。

**只授权同一 Session 保存的版本** — 已否决，因为 S3 明确允许一次 run 引用同一 project 中另一个 Session 产出的确切版本。该 Session 日志保留的 `(artifactId, ordinal)` 与持久 workspace，是这次跨 Session 引用的最小证据。

**增加 project 全量 artifact 列表 RPC** — 已否决，因为内容读取只需要一个通过 Session 鉴权的确切版本。project Files 呈现仍是独立范围，不由本读取方法隐含提供。

## 后果

Host API proxy 现在可选集成 `ScienceArtifactStore`；没有该 provider 的组合会明确拒绝读取，而所有无关 RPC 仍可使用。Store 读取错误保留 store 的稳定 code，未被引用的版本则以 `VERSION_NOT_REFERENCED` 失败。API carrier 与客户端 runtime 通过 base64 传输字节，并向呈现包暴露解码后的 `Uint8Array`。

S2 与 S3 Note 继续作为有效历史保留：本 Note 实现了 S2 建议的 Session 寻址 RPC，并对 S3 做了一项必要调整。跨 Session input 的 fold 无法提供 `projectId` 或 hash，因此鉴权通过由持久 Session header 推导出的 project 校验其 ordinal，而不是假装这些坐标已存在于本地 fold 中。
