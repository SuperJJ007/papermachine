# science/ — Science domain family

English | [中文](README.zh.md)

The Science domain: required-on-read Session events, host-local Runtime operations, strict replay, invariant validation, the client-safe `science` Session projection, and the five-tool model-facing Consumer. The built-in preset and browser transcript rows are application/client compositions; settings and current-state Details remain later work.

| Package | Role | ctx key |
|---|---|---|
| [`science-session/`](science-session/README.md) | Owns seven Science Session events, strict Host replay, the pre-commit invariant, client-safe projection, and artifact attachment extraction. | registers on `ctx.sessionProjections` / `ctx.sessionAttachments` when composed |
| [`science-runtime/`](science-runtime/README.md) | Host-local Conda Runtime: environment binding, Python/R execution, private scratch, run-written-file auto-capture, and metadata-only artifact curation. | `ctx.scienceRuntime` |
| [`tool-science/`](tool-science/README.md) | Model-facing Consumer: first-use binding/context plus `get_science_state`, `run_python`, `run_r`, `annotate_artifact`, and `publish_outcome`. | registers on `ctx.tools` / `ctx.systemPrompt` |

The child READMEs own the event, replay, projection, Runtime, and Consumer contracts. Browser presentation lives in [`client/ui-science`](../client/ui-science/README.md).
