# science/ — Science domain family

English | [中文](README.zh.md)

The Science domain: required-on-read Session events, strict replay, invariant validation, and the optional `science` session projection. Science Runtime, tools, preset, and client packages are later slices; this family currently owns durable vocabulary and replay only.

| Package | Role | ctx key |
|---|---|---|
| [`science-session/`](science-session/README.md) | Owns the six Science Session events, their strict fold, the pre-commit invariant, and the optional `science` projection. | (registers on `ctx.sessionProjections` when composed) |

The child README owns the event, replay, and projection contract.
