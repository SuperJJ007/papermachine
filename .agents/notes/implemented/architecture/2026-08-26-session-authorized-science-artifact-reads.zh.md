# Agent Note：Session 鉴权的 Science artifact 读取

Status: implemented

[English](2026-08-26-session-authorized-science-artifact-reads.md) | 中文

## 问题

[Project artifact store S2](2026-08-26-project-artifact-store-s2.zh.md) 从 `ScienceArtifactVersion` 移除了附件引用，但 `ui-science` 仍通过 Session 附件服务读取 artifact 字节。浏览器既无法针对当前投影编译，也无法安全读取 store blob：若接受客户端提供的 project id，请求就能选择与指定 Session 无关的鉴权域。

## 决定

`session.scienceArtifact({ sessionId, versionId })` 是浏览器读取一个不可变 Science artifact 版本的唯一途径。请求没有 project-id 字段。网关接受首条适用的证明：

| 证明 | 可信坐标 |
|---|---|
| 具名 Session fold 包含已保存版本 | 其中记录的 project id、hash、媒体类型和字节数 |
| fold 包含一个 [S3](2026-08-26-project-artifact-store-s3.zh.md) 跨 Session run input | Session header 的持久 `cwd` 推导 project；store 确认 artifact id 与 ordinal |
| 两条 fold 路径都未命中，但推导出的 project 包含精确 version id | `getVersion(projectId, versionId)` 提供版本元数据并证明同 project 成员关系 |

第三条路径支持 [project 文件库](../feature/2026-08-26-project-file-library.zh.md)：选择一个 Session 后，可以浏览由该 Session 推导出的 project 所拥有的不可变 artifact，包括同一 workspace 中其他 Session 产生的版本。另一个 workspace 会推导出不同 project，不能使用这条路径。

`ui-science` 保留无状态图像与文本 loader 的调用形状，但两者都调用 `ISession.readScienceArtifact(versionId)`。图像转成 `data:` URI，文本采用严格 UTF-8 解码。project store 元数据不含附件尺寸，因此 project-store 图像使用本包自己的预览组件。

## 已考虑的替代方案

**在 `versionId` 旁接受 `projectId`** — 已否决，因为客户端会在 Session 日志鉴权之前自行选择 store namespace。

**只授权同一 Session 保存的版本** — 已否决，因为 S3 明确允许一次 run 引用同一 project 中另一个 Session 产出的确切版本。该 Session 日志保留的 `(artifactId, ordinal)` 与持久 workspace，是这次跨 Session 引用的最小证据。

**只授权当前 Session 日志中点名的版本** — 已否决，因为 project 文件库会有意显示 Session 所属 project 的全部 artifact。要求添加合成引用事件会把浏览错误表达成对话历史。

## 后果

Host API proxy 现在可选集成 `ScienceArtifactStore`；没有该 provider 的组合会明确拒绝读取，而所有无关 RPC 仍可使用。Store 读取错误保留 store 的稳定 code，未被引用的版本则以 `VERSION_NOT_REFERENCED` 失败。API carrier 与客户端 runtime 通过 base64 传输字节，并向呈现包暴露解码后的 `Uint8Array`。

S2 与 S3 Note 继续作为有效历史保留：本 Note 实现了 S2 建议的 Session 寻址 RPC，并对 S3 做了一项必要调整。跨 Session input 的 fold 无法提供 `projectId` 或 hash，因此鉴权通过由持久 Session header 推导出的 project 校验其 ordinal，而不是假装这些坐标已存在于本地 fold 中。
