# Agent Note：Science artifact 原始字节读取走 HTTP，不走 JSON-RPC base64

状态：已实现

[English](2026-09-01-science-artifact-raw-byte-reads.md) | 中文

## 问题

此前每一次 Science artifact 读取都走 `session.scienceArtifact`，一个响应 schema 带 `data: string` 的 JSON-RPC 方法——blob 以 base64 编码（`api-proxy.ts` 里的 `Buffer.from(data).toString('base64')`）。base64 恰好膨胀 4/3 倍：样本语料里最大的 blob（2.5 MB）会变成一条 RPC 信封内约 3.4 MB 的 JSON 字符串字段，在任何字节到达消费方之前先被解析成一个 JavaScript 字符串。一次下载或一次大预览，每次读取都要为此付出这份膨胀，外加一整趟解码／重新编码。

浏览器侧的文本内容让这个问题变本加厉。`ScienceDetailsView.tsx` 的下载路径把 base64 载荷送进 `TextDecoder('utf-8', { fatal: true })` 还原成字符串，再用 `encodeURIComponent` 拼出一个 `data:` URI——解码、再编码，只为搬运浏览器本来就已经拥有的字节。由此直接产生了两个真实缺陷，不是实现疏漏：以 GBK 或 Latin-1 编码的 CSV（Science 工作区数据导出里很常见）会立刻触发 `TextDecoder` 的 `fatal: true` 失败，而失败本身被那句 `.catch(() => {})` 吞掉——用户点击非 UTF-8 CSV 的下载按钮，什么都不会发生，任何地方都不会浮现错误。另外，`data:` URI 有浏览器强制的长度上限；一个能干净解码的大 CSV 也可能仅因体积就下载失败，同样静默地经由那个空 catch 消失。

## 决定

**第二个宿主侧下载面 `GET /api/science/artifact/:sessionId/:versionId` 加入 `DownloadsApi` 领域，与 `session.export` 为伴（无线协议信封——`toFetchHandler` 像回答 `session.export` 一样把它当作物理路由直接回答）。** 路径不带 `projectId` 段；授权复用 `session.scienceArtifact` 已经在用的那个 `authorizedScienceArtifact` 函数（只扩展了让它也携带 `artifactId`／`ordinal`，这两个字段本就存在于它三条分支各自已经持有的 `VersionRecord` 上），因此客户端无法自行选择授权域——会话自身事件日志的折叠推导出项目，与 JSON-RPC 路径分毫不差。base64 RPC 不变，继续作为非浏览器调用方的读取路径（现存消费者清单见本任务报告的 grep 结果）；本端点是增量，不是替代。

**响应 body 是 `ScienceArtifactStore.readBlob` 返回的已校验 `Uint8Array`，原样交给 `Response`，中间不经过任何字符串。** 没有 base64，没有 `TextDecoder`，没有 `data:` URI。`Content-Type` 原样携带存储的 `mediaType`，不带 `charset` 参数——本端点从不检查字节猜测编码；上面那个非 UTF-8 CSV 缺陷正说明了为什么猜测比不猜更糟，把决定权留给浏览器自身的 BOM／启发式处理。`Content-Length` 是已校验的字节数，`Content-Disposition` 用所属工件当前的逻辑名（在扩展名前插入 `-v<ordinal>`，如 `chart.png` 第 3 版变成 `chart-v3.png`）命名，按 RFC 5987 双重编码（`filename*=UTF-8''…`），并为忽略扩展形式的用户代理附带 ASCII 安全的 `filename=` 兜底，`X-Content-Type-Options: nosniff` 始终设置。

**完整性是先校验后发送，不是边流边中断，因为 store 包没有从外部实现后者的办法。** `@deepseek-ai/dsh-science-artifact-store` 公开的 `exports` 映射只有 `.`、`./ids`、`./invariant`，以及一个仅供测试用的 `./src/*`——`blobs.ts` 里的 `readBlob`（在返回前把 blob 与其 `sha256` 校验哈希的那个函数）和把摘要解出磁盘路径的私有 `blobPath` 辅助函数，除了已公开的唯一方法 `ScienceArtifactStore.readBlob`（返回整份已校验缓冲区，而非流）之外，从 `dsh-host-apiproxy` 都够不到。本任务的范围只限 `packages/host/apiproxy`——给 store 包的公开面扩出一个流式变体属于那个包自己的所有者，不属于本次改动。结果反而是一个比流式设计更强的保证：本端点在写出任何响应头之前就持有一份完整校验过的缓冲区，因此客户端绝不会收到一个它无法兑现 `Content-Length` 承诺的部分响应，也绝不会出现一次被标记为完整、实际却悄悄未完成的下载。代价是每次并发下载多一份缓冲区拷贝，在已观测的语料体量下可以接受；真正流式的 `readBlob` 留给 store 包未来实现。

**三种失败结果各有独立且有文档记录的错误码；T3 的 `missingContent` 健康标记只命名了这个事实，却没有给这个端点定线上词汇，因此本任务来定义它。** 未获授权或不存在的会话/版本应答 404，body 固定为 `not found`——从不说明原因，从不回显 project id，客户端无法用响应内容枚举究竟存在什么。store 中缺失 blob 的版本（`ScienceArtifactStore.readBlob` 抛出 `BLOB_NOT_FOUND`）应答 410 Gone，带 `x-science-artifact-error: missing_content` 头——与 T3 的 `VersionHealthRecord.missingContent` 标记同名，刻意对齐（后续客户端改动可以在两处用同一套词汇，而不必再造一套）。完整性校验失败（`BLOB_CORRUPT`）的版本应答 409 Conflict，带 `content_corrupt`——T3 没有对应项，因为内容被篡改与"这一行不健康"是对账要追踪的两类不同失败。部署未挂载 `scienceArtifactStore` 服务时应答 500。

## 被否决的替代方案

**继续走 base64 JSON-RPC 路径，但把大 blob 拆成多条消息** —— 否决。分块既不能消除 base64 膨胀，也不能消除解码/重新编码那一趟，只是把同样的开销藏进两端的重组逻辑背后，对非 UTF-8 文本缺陷毫无帮助，后者的根因是"根本不该解码成 JS 字符串"，而不是消息体积。

**修非 UTF-8 缺陷的办法改为让客户端在拼 `data:` URI 之前先猜编码再重新解码** —— 否决，既因为超出本任务范围，也因为原则上就是错的：仅凭字节猜编码天生就是一场赌博（T4 自己的任务书就明确点出这一点），猜错了会像现在 `fatal: true` 的失败一样静默损坏数据，只是不那么显眼而已。正确的修法是彻底不需要为一次二进制传输经过 JS 字符串这一步，本端点直接做到了这一点。

**在本任务里就加一个真正的磁盘流式读取（对已解出的 blob 路径打开 `fs.createReadStream`）** —— 推迟，不是否决。这需要 `@deepseek-ai/dsh-science-artifact-store` 新增一个公开访问点（路径解析器或流式 `readBlob`），那是另一个包的公开面，明确不在本任务的边界之内。已在 `dsh-host-apiproxy` 的 README 里记为已知限制，而不是用跨包私有导入绕过去。

## 影响

范围：仅 `packages/host/apiproxy`（`src/api/downloads.ts`、`src/api/downloads.schema.ts`、`src/fetch/handler.ts`、`src/api-proxy.ts`、`tests/science-artifact-download.spec.ts`、`README.md`/`README.zh.md`）。`packages/science/*`、`packages/client/*`、`packages/api` 下没有任何文件改动——store 的读接口、对账机制、每一个客户端消费者都未被修改。`session.scienceArtifact` 的 base64 响应 schema、`authorizedScienceArtifact` 的三条证明路径、`ScienceArtifactStore` 的公开方法行为均未改变；`AuthorizedScienceArtifact` 新增的两个字段（`artifactId`、`ordinal`）在每条分支既有的 `VersionRecord` 读取里本就唾手可得，因此没有为此新增任何 store 调用。

图片/文本预览切到 `<img src>`/`fetch()`、Files 面板与详情面板的标题统一渲染，是这次迁移的另一部分工作，会在这同一篇 Note 里续写自己的小节，而不是为同一个端点另开一篇。

`packages/host/apiproxy/tests/science-artifact-download.spec.ts` 覆盖了逐字节透传（一个非 UTF-8/GBK 形态的 CSV fixture 与一个测试内生成、从不提交为二进制文件的 2 MB+ PNG fixture）、`Content-Length`/`Content-Disposition`/`nosniff` 响应头契约（含带 `attr-char` 排除字符 `!'()*` 的文件名的 RFC 5987 编码）、404 授权失败路径（断言响应 body 从不包含 project id）、410/409 错误码路径，以及 store 未挂载/授权本身抛错/读取失败的 500 路径。`npx vitest run packages/host/apiproxy --coverage --coverage.include='packages/host/apiproxy/src/**'` 报告在该包完整的 404 个测试、21 个文件的套件里，语句/分支/函数/行全部 100%（676/676、201/201、193/193、640/640）。

## 批量版本摘要读取(`sessions.scienceVersions`)

标题来源统一这项修复需要一个返回版本当前事实(标题/说明/内容来源)的 Host 读接口——取 `scienceArtifact` 和下载端点已经在读的同一条 store 记录,而不是版本被采集那一刻的会话日志快照。Files 面板的一页或版本步进器一次需要好几个版本,因此这个读接口按批处理,而不是每个版本单独请求一次:`sessions.scienceVersions(sessionId, versionIds[])` 返回 `{ versions: ScienceVersionSummary[] }`,每条 `{ versionId, artifactId, logicalName, ordinal, title?, caption?, contentOrigin, createdAt, mediaType, byteCount, health? }`。

**新开一个 RPC,而不是把 `scienceLibrary` 改宽——因为这两个调用回答的是不同的问题,授权形状也不同。** `scienceLibrary` 列出整个项目里每个 artifact 的一条最新记录——调用方完全不提供任何版本身份,它返回的每一行按定义对调用方都是可见的(调用方问的是"整个项目")。`scienceVersions` 回答的是"这些确切版本现在的事实是什么"——一个调用方自选的集合,可以跨项目里任意 artifact 的最新版本和历史版本混合,每一条都要独立经过 `authorizedScienceArtifact` 的证明(会话 fold 无法证明的版本,不能因为 `scienceLibrary` 把整个项目当作一个整体授权过就顺带泄漏进响应)。把这个能力并进 `scienceLibrary`,要么意味着每次 Files 面板加载都要为每个 artifact 返回它的全部历史版本(几乎没有调用方需要,却要每次都付出这个代价),要么意味着让那个 RPC 长出一个不相关的可选请求形状——`{ projectId }` 或 `{ versionIds }`二选一,把它自己的授权逻辑拆成一条 wire 方法上两条只在条件成立时才适用的规则。开第二个 RPC,让每个契约的授权规则保持单一,也让只需要 `scienceLibrary` 的调用方完全不必知道这条批量路径的存在。

**授权按每个 id 分别复用 `authorizedScienceArtifact`,未获授权的 id 静默剔除。** 每个请求的 `versionId` 都经过下载端点和 `session.scienceArtifact` 已经在用的同一套三条证明路径解析;会话 fold 无法证明的 id 从结果数组里省略,而不是让整次调用失败。这与 `scienceLibrary` 自己既有的规则是同一套(某个版本存储的媒体类型这个构建版本渲染不了,也会从那份列表里静默缺席)——调用方渲染的是一批各自独立授权的条目,部分可见是正常结果,不是对客户端可见的错误;这个省略也不携带任何信息(客户端无法从缺失的条目分辨"未获授权"和"已不存在",这与 `scienceArtifact` 自己不说明原因的 404 是同一个立场)。请求 schema 在任何查找发生之前就把单次调用的 id 数量固定上限为 200 个,限定单次调用的授权与 store 工作量。

**`AuthorizedScienceArtifact`(`scienceArtifact`、下载端点、这个新 RPC 共用的授权结果类型)新增了 `title`/`caption`/`contentOrigin`/`createdAt`。** 它的三条解析分支在这次改动之前就已经各自持有 store 返回的完整 `VersionRecord`(更早的 `artifactId`/`ordinal` 扩展就是同一个模式),所以在共享类型上多命名这四个已经取到的字段不需要额外的 store 往返;只有 `logicalName` 需要一次新的 `getArtifact` 调用,按 artifact 在一次批量调用内去重缓存,因为版本步进器的请求大多是同一个 artifact 的重复。

**影响**:`packages/host/apiproxy/src/api/sessions.ts`(`ScienceVersionSummary`/`ScienceContentOrigin` 类型与 `scienceVersions` 方法声明)、`src/api/sessions.schema.ts`(请求/响应 schema、`SCIENCE_VERSIONS_BATCH_LIMIT` 常量)、`src/api/rpc-map.ts`、`src/fetch/handler.ts`、`src/fetch/client.ts`(还导出了 `resolveApiOrigin`——从 `AbstractApiClient.resolveBase` 里拆出来,好让传输层之外需要同源 URL 的代码——客户端 runtime 的原始字节预览/下载帮助函数——不必自己硬编码就能拿到同一个 origin)、`src/api-proxy.ts`(`scienceVersions` 处理函数与 `AuthorizedScienceArtifact` 的字段扩展)及其测试。`packages/client/runtime` 新增了 `Session.readScienceVersions`、基于导出的 `resolveApiOrigin` 构建的 `scienceArtifactUrl(sessionId, versionId)` 帮助函数,以及 `readScienceLibrary` 声明返回类型上补上的 `health: ScienceLibraryHealth` 字段(wire 早就带着它,只是客户端这边的类型还没跟上)。`readScienceArtifact` 及其 base64 RPC 未变,继续留给非浏览器预览/下载的调用方。
