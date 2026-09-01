# @deepseek-ai/dsh-mcp-client

English | [中文](README.zh.md)

MCP client bridge plugin: connects to external [Model Context Protocol](https://modelcontextprotocol.io/) servers and registers their tools on `ctx.tools`, making them available to the model as native tools under server-qualified names (`mcp__<serverName>__<rawName>`).

## Usage

One plugin instance per MCP server in `cordis.yml`:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

The model sees `mcp__github__create_issue`, `mcp__web__search`, … — the same server-qualified shape Claude Code and Codex use. HMR hot-swaps: editing the entry triggers disconnect + reconnect without process restart; an unchanged `serverName` reproduces identical tool names.

## Config

| Field | Transport | Required | Description |
|---|---|---|---|
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `serverName` | both | yes | Namespace for this server's model-facing tool names; `[A-Za-z0-9_-]{1,32}`, unique across live instances |
| `command` | stdio | yes | Executable to spawn |
| `args` | stdio | no | Arguments passed to the command |
| `env` | stdio | no | Extra env vars merged on top of scrubbed ambient env |
| `cwd` | stdio | no | Working directory for the child process |
| `url` | http | yes | MCP server URL |
| `headers` | http | no | Extra headers (e.g. auth tokens) |
| `toolCallTimeoutMs` | both | no | Timeout per `callTool` invocation (default 60000) |
| `failOnStartupError` | both | no | Reject plugin activation when initial connection or tool synchronization fails (default `false`) |
| `reconnect.enabled` | both | no | Reconnect automatically after a lost connection (default `true`) |
| `reconnect.initialDelayMs` | both | no | First reconnect delay in ms; doubles per consecutive failed attempt (default 500) |
| `reconnect.maxDelayMs` | both | no | Backoff ceiling in ms; also the uptime after which the attempt budget resets (default 30000) |
| `reconnect.maxAttempts` | both | no | Consecutive failed attempts per outage before giving up for good (default 10) |
| `tools.include` | both | no | Only these server-advertised rawNames are registered; omission registers every discovered tool |
| `tools.exclude` | both | no | rawNames removed after `include` narrows the set; omission removes none |
| `tools.rename` | both | no | rawName → public-name suffix override, still normalized like any other tool name |
| `tools.describe` | both | no | rawName → model-facing description override |

## Tool naming

Every MCP tool has two names: the raw MCP name (sent on the wire in `tools/call`) and the public name `mcp__<serverName>__<rawName>` registered on `ctx.tools`. Public names are normalized to the DeepSeek function-name contract (64 chars, `[A-Za-z0-9_-]`); when replacement or truncation changes the name, a deterministic 12-hex-char hash of `(serverName, rawName)` is appended so distinct tools never collapse into one name. Names are pure functions of `(serverName, rawName)` — connection order, re-syncs, and other servers never rename a tool. A `tools.rename` entry substitutes its suffix for `rawName` in this derivation only; the raw name sent on the wire in `tools/call` is unaffected.

- Two servers publishing the same raw name (e.g. `search`) coexist under their namespaces.
- A duplicate `serverName` across live instances fails the later plugin instance at load.
- A server listing the same tool name twice is rejected as an invalid tool list.
- A foreign registration squatting on this server's namespace rolls back the whole generation (never a partial set), with a loud error.
- A `tools.rename` entry that collides with another tool's resolved public name — a server listing the same rawName twice, two rawNames renamed to the same suffix, or a rename that lands on another tool's unrenamed name — rolls back the whole generation the same way.

## Tool curation

`tools.include`/`exclude`/`rename`/`describe` are a deployment-level, server-side-of-the-model decision: which of a server's tools reach the model, under what name, and with what description — never a per-request or model choice. All four fields are optional and independent of each other; omitting `tools` entirely registers every discovered tool unchanged, with its server-provided name and description.

- `include` runs first: when non-empty, only listed rawNames pass. `exclude` then removes rawNames from what remains (or, with no `include`, from the full discovered set).
- `rename` substitutes its value for the rawName only when deriving the public name (`mcp__<serverName>__<suffix>`, normalized like any other tool name); it does not change the name sent on the wire.
- `describe` replaces the model-facing description used at registration; the server's own description is unused for that tool.
- **Validation is two-phase, matching the naming and reconnect failure semantics above.** `rename` target uniqueness is config-only and checked at plugin load, before any effect registers — two different rawNames renaming to the same suffix rejects plugin activation immediately, independent of what the server advertises. Every other check needs a live tool list, so it runs on every `syncTools` sync (initial connect, reconnect, and `notifications/tools/list_changed` re-sync alike): a rawName named anywhere in `include`/`exclude`/`rename`/`describe` that the connected server does not actually advertise is a loud, logged failure with the same shape as any other fetch-phase sync failure — the sync's promise rejects, so an initial connect is retried under the reconnect policy (or fails plugin activation when `failOnStartupError` is true), and a re-sync after `notifications/tools/list_changed` leaves the previous generation registered untouched. The filter itself is never silently narrowed to skip a bad reference.
- The resolved filter is fixed at plugin load and re-applied identically to every generation, including after a reconnect: a server that comes back with a different tool list is filtered by the same `include`/`exclude`/`rename`/`describe`, not reconfigured.

## Behavior

- On connect: plugin activation awaits `listTools()`, applies the configured tool filter, and registers each surviving tool via `ctx.tools.register()` under its public name before the composition starts its first turn. Initial connection, discovery, filter validation, or registration failure is always logged; it rejects activation when `failOnStartupError` is true and otherwise activates with no tools.
- Listens for `notifications/tools/list_changed` → re-syncs, re-applying the same tool filter; a fetch-phase failure (including a stale filter reference) keeps the previous generation registered, while a registration conflict rolls back the attempted generation and leaves no tools from that server.
- Tool execute: `client.callTool({ name: rawName, arguments }, { signal })` with timeout + abort support—the public name is never sent to the server.
- Canonical success is `{ content: JsonValue[], structuredContent? }`; complete JSON MCP blocks survive for programmatic callers. A supported advertised `outputSchema` validates `structuredContent`; unsupported schema vocabulary falls back to unconstrained `JsonValue`.
- Native/model rendering preserves MCP block order. Text-like runs join with newlines; resource links keep their name and URI as text; supported images become durable core image blocks only when `ctx.attachments` is mounted and the exact calling model route explicitly declares image input. The whole image batch is decoded and admitted before any member is saved. A malformed/refused image batch, audio, embedded resources, and unsupported blocks become explicit diagnostic text rather than disappearing.
- On disconnect/crash: the supervisor restarts the original server config with exponential backoff (`reconnect.initialDelayMs` doubling up to `reconnect.maxDelayMs`) and re-runs discovery, re-applying the same tool filter, on success — the recovered generation replaces the previous one, so tools neither duplicate nor leak. During the outage the last good generation stays registered; calls against it fail until recovery.
- Reconnection is budgeted per outage: after `reconnect.maxAttempts` consecutive failures the server's tools are unregistered and reconnection stops until an HMR reload or Host restart. A connection that survives past `maxDelayMs` resets the budget, so an occasionally-crashing server recovers indefinitely while a crash-looping one — even with briefly successful connects — still exhausts the cap instead of restarting forever.
- Reconnect states are user-visible in logs: reconnecting (warn, with attempt count and delay), recovered (info), final failure and disabled-loss (error). Disposal cancels any pending reconnect. With `reconnect.enabled: false`, a lost connection keeps tools registered but failing until a reload — the manual-recovery behavior.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.tools` | Register/unregister MCP tools |
| `ctx.attachments` | Optionally validate and persist image result batches before model projection |
| `ctx.llm` | Optionally prove the exact calling route explicitly supports image input |

## Model Experience

### Discovered MCP tools

#### What the model sees

After initial discovery succeeds, each advertised MCP tool that survives the configured `tools.include`/`exclude` filter appears as a native tool named `mcp__<serverName>__<rawName>` (or its `tools.rename`d or deterministic normalized form), with the server-provided or `tools.describe`-overridden description and the server's input schema. A model deployed with a curated `tools` config never sees a filtered-out tool's name, description, or schema — the excluded tool costs no tokens. A successful re-sync — including the one after an automatic reconnect — replaces the generation with the same filter re-applied; plugin disposal or an exhausted reconnect budget removes it.

#### Token effect

Data-dependent schema cost is paid on every request while the tools are registered. Re-sync replaces rather than accumulates schemas, and the server-qualified name adds tokens to every tool definition and call.

#### KV Cache effect

Prefix-stable while the discovered tool set and schemas are unchanged. A re-sync that adds, removes, renames, or changes a tool replaces definitions and may invalidate reuse from the first changed schema token; a reconnect that recovers an unchanged list reproduces identical definitions and stays prefix-stable.

### Tool-call history and results

#### What the model sees

The public tool name and JSON arguments remain in assistant history. The execution-local canonical value always retains the complete JSON MCP blocks and optional structured content for programmatic and Code Mode callers. In Native context, supported image blocks are durably projected beside text in their original order after exact route-capability proof; Code Mode additionally ferries that settled rich projection through the outer `run_code` result without changing the canonical binding value. Refused images, audio, embedded resources, resource links, and unknown blocks remain visible as bounded text diagnostics, and MCP `isError` rejects the call before image persistence.

#### Token effect

Arguments, mapped text, and durable image references are retained until compaction. Inline MCP base64 stays only in the execution-local canonical value and is never copied into a session event; the provider reads verified bytes from the attachment store. Audio and embedded-resource payloads stay out of model context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Tools are the only bridged MCP capability** — Resources and Prompts have no harness consumer and are deferred.
- **Startup timeout is inherited from the MCP SDK** — DSH does not yet expose a connection/discovery timeout. Each initialize or paginated `tools/list` request uses the SDK's 60-second default, so an unresponsive server or cursor chain can delay both activation and teardown while the initial synchronization settles.
- **Reconnect triggers on transport close** — a crashed stdio child fires it; Streamable HTTP failures surface per request and through the SDK transport's own SSE-stream recovery, so an unreachable HTTP server is retried per call rather than respawned by the supervisor.
- **Image is the only durable rich-result bridge** — PNG, JPEG, WebP, and GIF can enter Native context after exact capability proof. Audio and embedded-resource payloads remain execution-local with explicit diagnostics, while resource links preserve only their name and URI as text.
- **Unsupported MCP output schemas are not enforced** — `structuredContent` falls back to `JsonValue` when the advertised schema uses vocabulary outside the harness subset.
- **Tool curation is deployment-fixed, not model-driven** — `tools.include`/`exclude`/`rename`/`describe` are set once in `cordis.yml` and re-applied identically to every sync. There is no mechanism for the model to request a filtered-out tool by name or expand a curated set at runtime (a deferred-tools-directory pattern, distinct from this filter).
