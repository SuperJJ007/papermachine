# science/ — Science domain family

English | [中文](README.zh.md)

The Science domain: required-on-read Session events, host-local Runtime operations, strict replay, invariant validation, the optional `science` session projection, and the model-facing Consumer. Preset and client packages remain later slices.

| Package | Role | ctx key |
|---|---|---|
| [`science-session/`](science-session/README.md) | Owns the six Science Session events, their strict fold, the pre-commit invariant, and the optional `science` projection. | (registers on `ctx.sessionProjections` when composed) |
| [`science-runtime/`](science-runtime/README.md) | Folded host-local Conda Runtime: `bindEnvironment`, `startRun`, private scratch, and the environment/run Session events those operations append. | `ctx.scienceRuntime` |
| [`tool-science/`](tool-science/README.md) | Model-facing Consumer: first-use mode/environment binding, the `science:environment` dynamic context, and the `get_science_state`/`run_python`/`run_r` tools, all through `ctx.scienceRuntime`. No shipped composition. | (registers on `ctx.tools`/`ctx.systemPrompt`) |

The child READMEs own the event, replay, projection, Runtime, and Consumer contracts.
