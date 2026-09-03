# 匿名使用统计接收端

[English](README.md) | 中文

这个私有 workspace 包含 PaperMachine 只含元数据的使用事件所用的两个部署目标。两端接受同一个闭合 JSON 记录、拒绝未知字段、返回空响应，并且绝不保存请求 IP、User-Agent 或请求头。阿里云目标只读取 `Content-Length` 以执行 8 KiB 限制。Cloudflare Worker 还会读取 `cf-connecting-ip`，但只把它用作限速 key，绝不记录或持久化该值。

## HTTP 行为

- 只接受 `POST`；其他方法返回 `405` 和 `Allow: POST`。
- 大于 8 KiB 的 body 不经 JSON 解析就返回 `413`。
- JSON 格式错误、不支持的 event 或 schema version、非 UUID 的 event id 或 anonymous id、缺失或无效的已定义字段，或未知字段，均返回 `400` 且不持久化。
- 通过校验后，Cloudflare Worker 在每个 Cloudflare location 内按 `cf-connecting-ip` 限制为每 60 秒 20 个事件，用于保护 D1 写入量，而不是 Worker 本身的请求预算；非法请求不消耗此额度。缺少 `cf-connecting-ip` 请求头的请求（只在测试和本地 `wrangler dev` 下才会出现）会落入同一个共享的 `unknown` 桶。超出额度返回空的 `429`；限速器本身出错时会放行该事件，不做限速。
- 事件保存后返回空的 `204`。两个接收端都不做鉴权或 CORS 处理。

## 阿里云函数计算

把本目录作为代码根目录，部署到 `cn-hongkong` 的 Node.js 20 custom runtime Web 函数。启动命令设为 `node aliyun-fc/server.mjs`。server 从 `FC_SERVER_PORT` 读取监听端口，默认为 `9000`——这是函数计算针对可配置端口 Web 函数的官方示例和 API 默认值——如果 `FC_SERVER_PORT` 被设为非整数值，server 会拒绝启动。

接收端没有 NPM 依赖。每个合法事件会以一行裸 `JSON.stringify(event)` stdout 写入，供 SLS 采集。函数计算实例不提供持久的进程内状态，因此此目标有意省略写入时去重；SLS 查询按 `eventId` 去重。

把以下命令中的 `https://REPLACE_WITH_FC_ENDPOINT/` 替换成实际地址：

```sh
curl -i -X POST 'https://REPLACE_WITH_FC_ENDPOINT/' -H 'Content-Type: application/json' --data-binary '{"eventId":"2d9d7dd6-75e9-4e66-a64b-c7a72a5f6cc8","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"environment.installed","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1,"sourceId":"tuna","durationMs":4200,"environmentId":"general"}'
curl -i -X POST 'https://REPLACE_WITH_FC_ENDPOINT/' -H 'Content-Type: application/json' --data-binary '{"eventId":"not-a-uuid","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"app.launch","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1}'
```

## Cloudflare Worker 与 D1

Worker 入口是 [`cloudflare/worker.mjs`](cloudflare/worker.mjs)，D1 schema 位于 [`cloudflare/migrations/0001_create_events.sql`](cloudflare/migrations/0001_create_events.sql)，[`wrangler.toml`](wrangler.toml) 把数据库绑定为 `DB`，把限速器绑定为 `TELEMETRY_RATE_LIMIT`。Worker 填写 `received_at`，并针对 `event_id` 主键使用 `INSERT OR IGNORE`，因此重复 id 会返回同样的空 `204`，但不会再写一行。

在仓库根目录安装依赖并配置 Cloudflare 资源：

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:login
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:d1:create
# Copy the returned database_id into apps/telemetry-receivers/wrangler.toml.
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:d1:init
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:deploy
```

已部署的 Worker 使用 `https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/`：

```sh
curl -i -X POST 'https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/' -H 'Content-Type: application/json' --data-binary '{"eventId":"2d9d7dd6-75e9-4e66-a64b-c7a72a5f6cc8","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"environment.installed","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1,"sourceId":"tuna","durationMs":4200,"environmentId":"general"}'
curl -i -X POST 'https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/' -H 'Content-Type: application/json' --data-binary '{"eventId":"not-a-uuid","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"app.launch","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1}'
```

## 本地验证

不连接任何云服务即可运行无依赖测试：

```sh
pnpm --filter @deepseek-ai/dsh-telemetry-receivers test
```
