# Anonymous usage telemetry receivers

English | [中文](README.zh.md)

This private workspace contains the two deployment targets for PaperMachine's metadata-only usage events. Both targets accept the same closed JSON record, reject unknown fields, return empty responses, and never read or store the request IP, User-Agent, or headers beyond `Content-Length` for the 8 KiB limit.

## HTTP behavior

- `POST` is the only accepted method; other methods return `405` with `Allow: POST`.
- A body larger than 8 KiB returns `413` without JSON parsing.
- Malformed JSON, an unsupported event or schema version, a non-UUID event or anonymous id, a missing or invalid documented field, or an unknown field returns `400` without persistence.
- A stored event returns an empty `204`. Neither receiver performs authentication or CORS handling.

## Alibaba Cloud Function Compute

Deploy this directory as the code root of a Node.js 20 custom-runtime web function in `cn-hongkong`. Set the startup command to `node aliyun-fc/server.mjs`. The server reads its listening port from `FC_SERVER_PORT`, defaulting to `9000` — Function Compute's own documented example and API default for a configurable-port web function — and refuses to start if `FC_SERVER_PORT` is set to something other than an integer.

The receiver has no NPM dependencies. Each valid event is written as one bare `JSON.stringify(event)` stdout line for SLS ingestion. Function Compute instances do not provide durable process-local state, so this target deliberately omits write-time deduplication; SLS queries deduplicate by `eventId`.

Replace `https://REPLACE_WITH_FC_ENDPOINT/` in these tests:

```sh
curl -i -X POST 'https://REPLACE_WITH_FC_ENDPOINT/' -H 'Content-Type: application/json' --data-binary '{"eventId":"2d9d7dd6-75e9-4e66-a64b-c7a72a5f6cc8","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"environment.installed","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1,"sourceId":"tuna","durationMs":4200,"environmentId":"general"}'
curl -i -X POST 'https://REPLACE_WITH_FC_ENDPOINT/' -H 'Content-Type: application/json' --data-binary '{"eventId":"not-a-uuid","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"app.launch","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1}'
```

## Cloudflare Worker and D1

The Worker entry is [`cloudflare/worker.mjs`](cloudflare/worker.mjs), the D1 schema is [`cloudflare/migrations/0001_create_events.sql`](cloudflare/migrations/0001_create_events.sql), and [`wrangler.toml`](wrangler.toml) binds the database as `DB`. The Worker supplies `received_at` and uses `INSERT OR IGNORE` against the `event_id` primary key, so duplicate ids return the same empty `204` without another row.

From the repository root, install dependencies and configure the Cloudflare resources:

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:login
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:d1:create
# Copy the returned database_id into apps/telemetry-receivers/wrangler.toml.
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:d1:init
pnpm --filter @deepseek-ai/dsh-telemetry-receivers run cloudflare:deploy
```

The deployed Worker uses `https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/`:

```sh
curl -i -X POST 'https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/' -H 'Content-Type: application/json' --data-binary '{"eventId":"2d9d7dd6-75e9-4e66-a64b-c7a72a5f6cc8","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"environment.installed","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1,"sourceId":"tuna","durationMs":4200,"environmentId":"general"}'
curl -i -X POST 'https://dsh-telemetry.deepseek-ai-dsh-telemetry-receivers.workers.dev/' -H 'Content-Type: application/json' --data-binary '{"eventId":"not-a-uuid","anonymousId":"0c49f694-264f-47f9-b31f-d62bf23df371","event":"app.launch","timestamp":"2026-09-01T08:00:00.000Z","appVersion":"0.1.1-rc.3","platform":"darwin","arch":"arm64","schemaVersion":1}'
```

## Local verification

Run the dependency-free tests without contacting either provider:

```sh
pnpm --filter @deepseek-ai/dsh-telemetry-receivers test
```
