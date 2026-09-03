# Agent Note: Science 上下文预算——豁免 skill 修剪、收缩内置 skill 正文

Status: implemented

[English](2026-09-04-science-context-budget-skill-bodies-and-pruner-exemption.md) | 中文

## 问题

Science 预设的 `tool-result-pruner` 行会对超过 8192 字符的 `tool/result` 做首尾截断。`skill` 结果是模型应当完整遵循的指令，不是可丢弃的数据：一旦 session 增长到触发修剪，被截断的 skill 正文会在不被察觉的情况下从中段丢失守则与工作流步骤,模型无从察觉。此前 pruner 无法按结果所属工具的名称豁免——只有大小驱动这一决策。

三个内置默认 Science skill 中有两个本身就已经超过该阈值(`scientific-visualization` 12.6KB、`scientific-writing` 13.0KB、`statistical-analysis` 20.0KB),因此仅靠豁免并不足够:豁免能阻止截断,但一个仍然超大的正文每次加载时依旧会占用一次 session 大部分的上下文预算。

## 决策

### compaction-tool-result-pruner 新增 `exemptTools` Config 字段

`ToolResultPruneConfig` 新增 `exemptTools: string[]`(默认 `[]`,在 `resolveConfig` 中校验为字符串数组,并写入 `static Config` 的 zod schema)。`pruneSession` 按 call id 解析每个候选快照所属的 `tool/call` 名称(每次修剪只构建一次的 O(n) map,而非对每条结果重复做反向扫描),并跳过名称落在 `exemptTools` 中的候选——该结果保留在 surface 中不动,绝不做首尾截断。无法解析的 call id(同一快照内找不到匹配 call 的孤立结果)按非豁免处理,与 pruner 既有的"无名即无保护"默认行为一致。这是一个 Config 字段而非常量,符合仓库"禁止在插件中硬编码可调参数"的规则:哪些工具名称被豁免是部署/预设层面的选择,不是包默认值。

Science 预设的 `tool-result-pruner` 行设置 `exemptTools: [skill]`——`'skill'` 是 `dsh-tool-skill` 注册的工具名(`packages/skill/tool-skill/src/index.ts`)。这是预设策略,不是包默认值:组合同一 pruner 包的其他预设可以做出各自的选择。

### 内置 Science skill 正文重写以适配阈值

豁免能阻止截断,却解决不了正文本身已经大于阈值、每次加载都占满 session 大部分上下文预算的问题。每个内置 `SKILL.md`(`apps/desktop/resources/skills/{scientific-visualization,scientific-writing,statistical-analysis}/SKILL.md`)的正文都被重写至 8000 字节以内——比预设 8192 字符的 pruner 阈值留有余量,并由 `bundled-skills.spec.ts` 针对解析后的、去除 frontmatter 的 `content` 字段断言,这与 `skill` 工具结果实际携带的字段相同。

重写保持 `name` 不变(`bundled-skills.spec.ts` 中另有断言),并保留每一条不可协商的守则与工作流步骤——要么以简短的祈使句/编号步骤形式留在正文中,要么移入该 skill 自己的 `references/*.md` 并以路径链接指向——整个 skill 层面没有任何内容被删除,收缩的只是始终加载的正文。`description` 改写为 1-2 句触发场景说明,并附加中文触发词,与 Science agent 的 `skill` 工具实际挑选候选的方式一致。假定存在 shell 或 `Write`/`Edit` 的工具专属说明(Science agent 只有只读工作区加 `run_python`/`run_r`)被改写为指名 agent 实际拥有的工具。`scientific-visualization` 的 `allowed-tools` frontmatter 行被删除:`skill-filesystem` 的 frontmatter 解析器(`packages/skill/skill-filesystem/src/index.ts` 的 `parseSkillFile`)只读取 `name`、`description`、`whenToUse`、调用策略相关键与 `metadata`——`allowed-tools` 从未被该 harness 读取过。

`SOURCES.md` 的政策声明从"逐字复制"改为:`SKILL.md` 正文为适配模型上下文预算与 Science agent 工具集而在本地重写;`references/`、`scripts/`、`assets/` 保持逐字不变;重新拷贝流程会针对新的上游正文重新套用该正文重写,并记录上游 commit。这一表述专门取代了此前针对 `SKILL.md` 的"全部逐字复制"声明——上游 commit 与 license 行保持不变。

### 测试覆盖

`compaction-tool-result-pruner` 的测试覆盖了:豁免工具的结果保持不动、非豁免结果被修剪、未知 call id 按非豁免处理,以及 `exemptTools` 配置拒绝非字符串条目。`bundled-skills.spec.ts` 新增断言:每个内置 skill 的 `content` 都 `<=8000` 字符,并严格低于预设 `8192` 字符的 pruner 阈值(在测试中命名并注释,指向预设中的对应行)——这正是 `exemptTools: [skill]` 豁免所依赖的不变量:豁免之所以有意义,前提是正文本身已经能一次性放下。

## 已考虑的替代方案

**提高 pruner 阈值,而非做豁免或收缩正文。** 已拒绝:该阈值保护 session 中的每一条工具结果,不只是 skill 正文;全局提高阈值会让超大的非 skill 结果(一次很大的文件读取、一条冗长的工具错误)也不受截断,而这与实际问题毫无关系。

**只按大小豁免(跳过修剪所有已经低于某个更小临界值的结果),不按工具名。** 已拒绝:低于该临界值的大型非 skill 结果也会被意外豁免于修剪之外,而且这种豁免无法说明*为什么*某条结果受保护。按工具名命名让该策略在预设自身的配置中清晰可读,并且可以独立于任何一条结果的大小进行审计。

**保持 skill 正文原始大小,只依赖豁免。** 已拒绝,原因见"问题"一节:一个未被修剪但仍然超大的正文,每次该 skill 触发加载时依旧会占用 session 大部分预算,这正是本笔记要解决的实际上下文预算问题,而不仅仅是截断风险。

## 后果

在任何选择通过 `exemptTools` 启用该豁免的预设中,`skill` 结果无论大小都不会被截断。Science 预设内置的三个默认 skill 即便在豁免生效之前,也已经各自留有余量地低于 pruner 阈值,因此该豁免目前是这三个 skill 的第二道防线,而非唯一保护——一旦某个 skill 正文(无论内置还是用户提供)自身超过阈值,该豁免就会成为关键防线。除 skill 正文措辞外,没有任何 session event、工具 schema 或模型可见字段发生变化;没有任何 keyless snapshot fixture 引用 Science persona、内置 skill 文本或 pruner 配置,因此本次改动无需刷新任何 fixture。
