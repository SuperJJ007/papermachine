# Agent Note: 让原始字节 Science 成果端点也路由 HEAD

Status: implemented

[English](2026-09-02-science-artifact-head-route.md) | 中文

## 问题

`GET /api/science/artifact/:sessionId/:versionId`（[原始字节读取](../architecture/2026-09-01-science-artifact-raw-byte-reads.zh.md)端点）落地时,客户端下载流程会先对这个确切 URL 发一次 HEAD 预检,再决定要不要真的创建保存用的 `<a>` 标签——目的是在弹出浏览器保存对话框之前,先把 410/409/其他失败分类清楚（`ScienceDetailsView.tsx` 的 `downloadArtifact`）。但 `packages/host/apiproxy/src/fetch/handler.ts` 里这条路由的匹配条件只写了 `req.method === 'GET'`,而就在同一文件里往上三行的 `session.export` 姐妹端点早就同时处理了 `GET || HEAD`。HEAD 请求永远匹配不上这条正则,于是落到只认 POST 的通用分发器里,回一个不带 `x-science-artifact-error` 头的裸载体失败——预检本身永远失败,导致真实部署里点下载永远显示"下载失败,请重试",跟目标版本本身健不健康毫无关系。`packages/host/apiproxy/tests/science-artifact-download.spec.ts` 号称这个文件 100% 覆盖率,却从来没发过一次 HEAD 请求,所以这个缺陷能上线还能过 CI——一个只认某个 HTTP 方法的路由缺口,对一个只发另一个方法的测试套件是不可见的。

## 决策

让 HEAD 走跟 GET 一样的匹配分支,照抄同文件里紧挨着的 `session.export` 那套写法:HEAD 请求时,一样 await 同一个 `api.downloads.scienceArtifact(...)` 调用,取消它的 body,然后返回一个不带载体、但状态码和响应头(`x-science-artifact-error`、`Content-Type`、`Content-Length`、`Content-Disposition` 都原样保留)不变的 `Response`。`api.downloads.scienceArtifact` 本身不用动——它每条分支（200/404/410/409/500）本来就返回一个正常的 `Response`；缺的只是承载层的方法门槛,以及调用之后对 HEAD 做的那次裁剪。

## 考虑过的替代方案

**让客户端去掉 HEAD 预检,退回到围着 `<a>` 点击套 try/catch。** 拒绝:这正是[原始字节读取 Note](../architecture/2026-09-01-science-artifact-raw-byte-reads.zh.md)取代掉的老设计（base64 路径那个 `.catch(() => {})` 失败时悄无声息）——退回去等于复活那次迁移刚修掉的缺陷,而不是修好本 Note 要修的这次回归。

**在 `UNARY_ROUTES` 里单独加一条 `HEAD` 分支。** 拒绝:`UNARY_ROUTES` 分发的是 POST/JSON 信封的 RPC 面；原始字节端点刻意做成一条无信封的物理路由（见父 Note）,它的 HEAD 处理理应挨着自己的 GET 分支写,而不是塞进 RPC 表里。

## 后果

`packages/host/apiproxy/src/fetch/handler.ts`（路由匹配 + HEAD 裁剪）、`src/api/downloads.ts`（JSDoc 补上 HEAD 契约）、`tests/science-artifact-download.spec.ts`（新增三个 HEAD 用例：200 成功裁剪、无载体的 410、无载体的 404——会话无法证明该版本时——`npx vitest run packages/host/apiproxy` 417/417 全绿,oxlint 干净）。客户端没有任何文件改动：`ScienceDetailsView.tsx` 的 `downloadArtifact` 本来假定的契约就是对的,本 Note 只是让服务端真正兑现它。这个缺陷是在为 T4c-2 的截图/GIF 证据搭建一个真实的、经 `launchWebScaffold` 播种的场景时发现的——面对一个 blob 健康的真实服务器,下载按钮照样失败,而这正是一个 mock 掉 `fetch` 的单元测试永远看不见的那种缺口。
