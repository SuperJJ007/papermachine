# science/ — Science domain family

English | [中文](README.zh.md)

The Science domain: required-on-read Session events, host-local Runtime operations, strict replay, invariant validation, and the optional `science` session projection. Tools, preset, and client packages remain later slices.

| Package | Role | ctx key |
|---|---|---|
| [`science-session/`](science-session/README.md) | Owns the six Science Session events, their strict fold, the pre-commit invariant, and the optional `science` projection. | (registers on `ctx.sessionProjections` when composed) |
| [`science-runtime/`](science-runtime/README.md) | Folded host-local Conda Runtime: `bindEnvironment`, `startRun`, private scratch, and the environment/run Session events those operations append. | `ctx.scienceRuntime` |

The child READMEs own the event, replay, projection, and Runtime contracts.
