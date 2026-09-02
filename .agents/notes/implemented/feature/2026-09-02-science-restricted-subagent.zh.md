# Agent Note: Science preset 获得一个受限 subagent

Status: implemented

[English](2026-09-02-science-restricted-subagent.md) | 中文

## 问题

`science` preset 此前完全没有 delegation 工具。当研究者的任务天然拆成互相独立的子工作——文献检索与数据探索并行,或一次足够耗时、可以放手不管的探索性分析——agent 没有任何办法把它并行出去:一切都得自己在同一个内核里、按顺序做完。

其余每个已发布的 preset(`standard`/`code`/`cordis`)都组装了一个 `delegation` group,给模型 `subagent`、`subagent_fork`、`send_message`、`interrupt_agent`、`list_agents`,外加 workflow 工具集。这些原样搬过来都不适合现在的 Science:被派生的子 agent 默认继承父 agent 的整份工具名单(`composeFrom()` 加入的是同一个 standing composition),所以照抄 `standard` 的这个 group,会把 shell、文件写入/编辑、装包、以及不受限的再派生统统交给 Science 子 agent——而这些恰恰是 preset 自己头部注释里明确列出、父 agent 层面本就刻意没有的能力。

产品决定(本仓库的用户,2026-09-02 做出)是:现在就先挂一个**受限**的 subagent,而不是等 Science 更完整的角色化 Specialists 设计(逐角色 persona、跨子 agent 结果合并、子 agent 持久身份、恢复合同)做完再动手。

## 决定

**Science 组装自己的 `delegation` group,只保留三行**,结构上照抄 `standard` 的写法,但砍到受限设计恰好需要的部分:

- `tool-subagent-control`(`send_message`、`interrupt_agent`)与 `tool-subagent-control/list-agents`(`list_agents`)——与 `standard` 完全相同的共享子 agent 消息/列表工具。
- 一个 `tool-subagent` 实例:`provider: spawn`、`toolName: subagent`、`backgroundMode: continuable`、`maxDepth: 1`、一段子 agent 专属 `persona`,以及一份 `toolFilter.deny` 名单。

**没有 fork,没有 Codex,没有 Claude Code,没有 workflow 工具集。** `standard` 的 `tool-subagent-fork` 行、已禁用的 `tool-subagent-codex`/`tool-subagent-claude-code` 行、`workflow-worker-thread`、`tool-workflow`、`tool-ralph` 全部不存在。fork 复用的是父 agent 已完成的历史,而这恰恰是 Science 派生的子 agent不该有的东西(它按设计要起一个全新内核,把父 agent 的轮次回放进它的 prompt,只会诱使模型误以为存在实际不存在的共享状态);其余的 provider 是本部署没有安装的可选 Bundle;workflow 工具集与本次受限改动无关,没有加进来。

**`maxDepth: 1` 禁止孙 agent。** 被派生的子 agent 自己的 `tool-subagent` 行(通过 `composeFrom()` 继承而来)携带同样的上限,因此子 agent 若尝试再往下派,会在 start 时被深度检查直接拒绝——这独立于 `toolFilter` 干脆拒绝子 agent 自己的 `subagent` 工具这件事。两个机制守住的是同一条边界;单独任何一个都不足以在评审里自证充分,所以两个都留着,并在这里一并记录。

**`toolFilter` 用 `deny`,不用 `allow`。** `allow` 名单必须与父 agent 的完整名单保持同步,否则会悄悄砍掉 Science 其实想让子 agent 保留的东西(`report`、`read`、`glob`/`grep`、`skill`、`web_search`/`web_fetch`、`todo_write`),除非这份 `toolFilter` 被记住并同步更新;`deny` 名单只需要点名正在被移除的那几项,其余一切——包括未来父 agent 名单上任何新增的行——默认保持可见。被拒的名字是:`install_science_packages`(子 agent 内部不能装包)、`subagent`(不能再往下派,与 `maxDepth: 1` 重复)、`send_message`/`interrupt_agent`/`list_agents`(子 agent 不能给兄弟消息或管理它们——它不是协调者)、`exit_plan_mode`(plan mode 是父 agent 层面的工作流,子 agent 没有理由调用)、`ask_user_question`(子 agent 向父 agent 汇报,不直接问用户)。

**这个 group 上没有 `isolate: workflowEngine`。** `standard` 的 `delegation` group 携带这个 realm,是因为它还组装了 `workflow-worker-thread`/`tool-workflow`/`tool-ralph`——仓库里仅有的会注入 `ctx.workflowEngine` 的几行;这个 group 的三行都没碰它,这个 group 自己也不发布任何 service——直接对照 `packages/workflow/*/src/index.ts` 各自的 `inject` 列表核实过,本 preset 都没有组装其中任何一个。

**`spawn` provider 以及共享的 `subagents`/子 agent 控制工具包早已可用。** `packages/bundle/base/cordis.patch.yml` 已经在 host 根层为每个包含 base bundle 的 profile 挂载了 `subagent`、`subagent-spawn-in-process`、`tool-subagent-control`、`tool-subagent-control/list-agents`;本 preset 的这几行只是解析既有的 host 注册表,与 `standard` 的做法完全一样,不需要新增任何 bundle 接线。

**子 agent persona** 用中文交代五件事,与产品以中文为主的工作风格一致:它是 PaperMachine 的 Science 子 agent,只做交给它的这一件具体任务;它跑在自己独立的内核里,不共享父 agent 的任何变量(需要的东西自己重新计算或读取);它的工作区只读,不能装包;完成前必须调用 `report`,交代结论、关键数字,以及每个产出成果的 `logical_name`;不确定就如实汇报,不要猜。

**父 agent persona 增加三句话**:何时该派子 agent(真正独立的并行工作,或一次可以放手让它自己跑完的长耗时探索性分析)、提醒子 agent 的内核是从空的开始起跑、以及在把子 agent 报告的数字转述给用户之前先复核。

## 备选方案

- **原样复用 `standard` 的 `delegation` group。** 已否决:这会把 shell 和文件写入/编辑交给 Science 子 agent——而这恰恰是 Science 自己的设计(只读工作区、无 shell)在父 agent 层面也从未给过的能力——外加 fork、Codex/Claude Code provider 行、workflow 工具集,没有一样适合先挂的受限版本。
- **用 `allow` 名单代替 `deny`。** 已否决:`allow` 必须列全子 agent 该保留的每一个工具,除非这份 `toolFilter` 被记住并同步更新,否则会悄悄砍掉未来名单新增的一项(新组装的一行);`deny` 只需要点名正在被移除的东西。
- **既然 `toolFilter` 已经拒绝了 `subagent`,就不加 `maxDepth: 1`。** 已否决:`toolFilter` 是对这个子 agent 自身工具 schema 的可见性限制,不是运行时另行强制的权限上限(`docs/subsystems/subagent.md` 里 `maxDepth` 字段才是真正的深度上限);只靠工具 schema 移除,一旦这个 preset 未来的 `toolFilter` 改得不完整,就没有运行时的兜底。
- **现在就搭建 Science 的角色化 Specialists 设计,而不是先挂一个受限的通用 subagent。** 推迟,非否决:逐角色 persona、跨子 agent 结果合并、子 agent 持久身份、恢复合同都是真实的产品需求,但设计体量远大于本次改动。明确的产品决定是先交付这个更窄、但已经有用的能力。

## 后果

`science` preset 的模型工具名单从十三个增长到十七个(不计条件性存在的 `glob`/`grep`):新增 `interrupt_agent`、`list_agents`、`send_message`、`subagent`。`apps/cli/tests/web-agent-presets.e2e.ts` 中 `science` 的精确名单断言相应更新,其隔离测试现在断言 `science` 与 `standard` 都携带 `subagent`(从禁止工具列表中去掉它),同时 `bash`/`write`/`edit` 仍是 `science` 的禁止项。`apps/web/tests/science-preset.snapshot.ts` 的名单断言同样更新;其 `session.jsonl` fixture 是本次改动之前录制的,需要用真实 key 重新录制之后该 suite 的 replay 模式才重新可信——这是 2026-09-01 web/plan 改动就已经留下的同一笔已知后续工作,不是本次新引入的。`docs/subsystems/science.md`/`.zh.md` 点名新的受限 subagent 组合,并链接本文档。

## 测试

`packages/preset` 与 `apps/cli` 的 unit/e2e 套件、`examples/headless-agent` 的无密钥 snapshot 套件(不受影响:其 `science-tools` 场景直接组装 `dsh-tool-science`,而非 `science` preset)、`verify-cordis-config`,以及针对文档改动的 `verify-translation-pairing`/`verify-doc-refs`。针对组装好的 `science` preset 做了两次真实 API 的 delegation 调用(真实 Conda 内核,不是 fixture),验证子 agent 的工具名单在运行时确实受限、且子 agent 跑在与父 agent 分开的独立内核里——具体转录与一张浏览器里 delegation 呈现的截图见 PR 描述。
