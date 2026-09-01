# Agent Note: Science preset gains web search/fetch and plan mode

Status: implemented

English | [中文](2026-09-01-science-web-and-plan.zh.md)

## Problem

The `science` preset carried no route to the outside web and no plan mode. A researcher asking the agent to look up a package's current API, a method's canonical write-up, or a dataset's documentation had no tool for it; the model either guessed from training data or told the user it could not check. The same preset also skipped `planning`, so a multi-step analysis — clean data, fit or evaluate a model, produce a chart — ran straight into `run_python` with no upfront plan a user could review before code executed against the bound Conda prefix.

Both gaps were deliberate placeholders, not accidents: the preset's own header comment named "no delegation or Web search" as a listed limitation, alongside the shell/write/edit/delegation restrictions that remain Science's actual design.

## Decision

**Science composes its own `tool-web` row, with `fetch: true` where every other shipped preset (`standard`/`code`/`cordis`) keeps `fetch: false`.** `run_python`/`run_r` already execute arbitrary code against the bound environment with no network isolation (`docs/subsystems/science.md`'s Runtime section: file-write confinement "does not isolate reads, network, syscalls, or scientific correctness"), so `web_fetch` — retrieving one HTTP(S) URL through `@deepseek-ai/dsh-web-fetch-http` — adds no exposure this agent's execution path did not already have. No other preset changes: their `tool-web` rows keep `fetch: false` exactly as before.

**`web-fetch-http` is now mounted at the host `dsh-base` bundle layer (`packages/bundle/base/cordis.patch.yml`), alongside the pre-existing `web-search-deepseek`.** It was not mounted anywhere in the repository before this change; the base bundle's own comment said so explicitly ("no fetch provider is mounted") and named the provider's own documented SSRF gap (no private/loopback/link-local blocking) as the reason. Mounting it once at the host layer, rather than per-preset, is required by the architecture, not a preference: `ctx.web` is a host-root singleton service (matching `web-search-deepseek`'s existing placement), and a provider mounted inside a per-session preset entry would attempt to register the same provider id on that singleton once per concurrently mounted session, throwing `WEB_DUPLICATE_PROVIDER` on the second one. Registering the provider does not, by itself, expose `web_fetch` to any agent — only a preset's own `tool-web` config does that, and only `science`'s does.

**Science composes its own literal copy of the `planning` group**, identical in structure to `standard`/`code`/`cordis` (`cordis:group` under an entry-local `planMode` realm, wrapping `@deepseek-ai/dsh-plan-mode`), with one added paragraph in its `section` text naming Science's own threshold for when a plan is expected: three or more steps, or any pipeline that cleans data, fits or evaluates a model, and produces a chart. This mirrors the existing pattern of each preset carrying its own literal `compaction`/`skills` rows rather than one shared included fragment — a deliberate byte-for-byte copy is already how these presets stay independently editable per [`packages/preset/agent-presets/README.md`](../../../../packages/preset/agent-presets/README.md)'s non-copyable-preset rationale.

**The persona gains two sentences**: when to reach for `web_search`/`web_fetch` (general reference — method background, dataset documentation, package/API usage) versus a paper-lookup MCP tool when one is composed (named by convention `mcp__papers__*`/`mcp__arxiv__*`, preferred for literature search, citation lookup, or a paper's full text), and a standing instruction to name the source URL or citation for anything pulled from either before relying on it in an analysis.

**The model tool roster grows from ten to thirteen** (excluding the always-conditionally-present `glob`/`grep`): `annotate_artifact`, `ask_user_question`, `exit_plan_mode`, `get_science_state`, `install_science_packages`, `read`, `read_image`, `run_python`, `run_r`, `skill`, `todo_write`, `web_fetch`, `web_search`.

## Alternatives considered

- **Reuse `standard`'s roster wholesale (shell, write/edit, delegation) instead of composing a narrower set.** Rejected: Science's entire design is a restricted composition — read-only filesystem, no shell, no delegation — and this change adds exactly two capabilities (web read, plan) to that design rather than abandoning it. The preset's own header comment states this explicitly.
- **Enable only `web_search`, leaving `fetch: false` like every other preset.** Rejected: unlike `standard`/`code`/`cordis`, Science's `run_python`/`run_r` already reach the network directly with no sandboxed egress control, so withholding `web_fetch` buys no additional isolation while blocking the ordinary follow-up of reading a specific page a search result named.
- **Mount `web-fetch-http` inside the `science` preset's own entry, isolated like `compaction`/`planMode`.** Rejected: `ctx.web` is not a per-agent service — it is the same host-root singleton `web-search-deepseek` already registers into. A provider mounted per preset-session would re-register the same provider id on every concurrently mounted Science session, and the second concurrent mount would throw `WEB_DUPLICATE_PROVIDER`.
- **Add a repo-wide plan-mode addendum for "when to plan" instead of a Science-only sentence.** Rejected: the three-or-more-step / clean-model-chart threshold is Science-specific criteria, not a general harness default; every other preset's `plan-mode` `section` stays byte-identical shared boilerplate.
- **Stand up a bundled papers/arXiv MCP server as part of this change.** Deferred: no such server exists in-tree. The persona only names the `mcp__papers__*`/`mcp__arxiv__*` naming convention it will recognize if and when one is composed onto this preset, so the guidance is not dead weight in the meantime but adds no new tool itself.

## Consequences

`apps/cli/tests/web-agent-presets.e2e.ts`'s exact-roster assertion for `science` grows to include `exit_plan_mode`, `web_fetch`, and `web_search`; its isolation test's forbidden-tool list drops `web_search` (Science now shares it with `standard`) and separately asserts `standard` lacks `web_fetch` while `science` has both. `apps/web/tests/science-preset.snapshot.ts`'s roster assertion is updated the same way; its `session.jsonl` fixture was recorded before this change and needs re-recording with a live key before that suite's replay mode is trustworthy again — tracked as a known follow-up, not performed here (re-recording requires `DEEPSEEK_API_KEY` and this change avoided further real-API recording beyond the two manual verification calls in the PR). `packages/bundle/base/package.json` gains a `@deepseek-ai/dsh-web-fetch-http` dependency; `docs/subsystems/science.md`/`.zh.md` name the new preset composition and the asymmetric `fetch: true`.

## Testing

`packages/preset` and `apps/cli` unit/e2e suites, `examples/headless-agent`'s keyless snapshot suite (unaffected: its `science-tools` scenario composes `dsh-tool-science` directly, not the `science` preset, and its base `cordis.yml` does not include the `dsh-base` bundle patch touched here), `verify-cordis-config`, and `verify-translation-pairing`/`verify-doc-refs` for the documentation changes. See the PR description for the exact commands run and a live-key transcript exercising `web_search`/`web_fetch` and a plan-triggering multi-step prompt against the `science` preset.
