# science/：Science 领域家族

[English](README.md) | 中文

Science 领域：required-on-read 的 Session 事件、严格重放、invariant 校验，以及可选的 `science` session projection。Science Runtime、工具、preset 与客户端包属于后续切片；本家族目前只拥有持久化词汇与重放能力。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`science-session/`](science-session/README.md) | 拥有六个 Science Session 事件、其严格 fold、pre-commit invariant，以及可选的 `science` projection。 | （组合时注册到 `ctx.sessionProjections`） |

子级 README 负责事件、重放与 projection 约定。
