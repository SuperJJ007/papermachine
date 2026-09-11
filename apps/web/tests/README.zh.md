# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实 Chromium 通过真实 HTTP 驱动它。该 lane
的运行机制——模式、fixture、golden，以及与 `dsh web` 之间刻意保留的组合差异——记录在
[`scaffold.ts`](scaffold.ts) 和
[浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)中。

## Science 回放暂存目录

Science 录制会话场景默认在仓库下创建隔离的 harness 主目录。若检出目录位于临时目录下，请将 `DSH_WEB_SCIENCE_SCRATCH_PARENT` 设为一个已存在、可写且位于规范化后的 `/tmp` 和 `os.tmpdir()` 之外的目录。测试会拒绝临时目录中的父目录，分配唯一子目录，并在清理时删除该子目录；所选父目录会保留。

## 混合 Science 成果

`science-mixed.snapshot.ts` 通过包含 Science、文件系统和 `present` 工具的私有测试预设录制一个真实模型回合。Science runtime 保留其沙箱规则，并使用与 `science-preset.snapshot.ts` 共用的精确操作内核 fixture；文件系统与交付工具正常执行。回放会先检查持久化 PNG 字节、完整工作区预期结果、推理和显式交付，再比较浏览器对话记录。出货 Science 预设保留独立的受限工具断言。

混合回放还验证原生已完成回合的过程展开、持久化的 Normal/Compact 设置以及浏览器重载。测试断言最终回答和两类交付组保持可见，同时物理 Session 日志、持久化事件和选定录制的字节内容不变。`ui-chat` 负责流式、取消和不完整历史的策略测试；`ui-science` 负责 Python/R 单元格详情及仅含推理的组合场景。单元格输出展开控件不替代原生回合级开关。

## 完成状态观察

依赖状态的用例使用 Workspace、接纳、附件和模型流屏障，区分可见中间状态与已完成操作。详情关闭等待框架过渡结束；归档验证为 seed Session 设置显式标题，并跨重载跟踪该身份。参见 [CI fixture 同步决策](../../../.agents/notes/implemented/testing/2026-09-08-ci-completion-observations.zh.md)。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取
Host 服务：`ctx.connection`、Host 侧 `SessionStore` 与 `ctx.sessionProjectionCache`。运行时驱动
浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 cordis
`Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处
Host 服务访问都无法编译。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程
拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的
Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译，
于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的
import 点明源模块。这样漂移会表现为选择器未命中或镜像值过期——是响亮的失败，绝不会是静默
通过。`scaffold.ts` 按此规则镜像欢迎声明的 namespace、确认字段、版本和被断言的中文文案。

有一类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从
`@deepseek-ai/dsh-client-web` import `AppWebEntry`、从
`@deepseek-ai/dsh-client-modules/client` import boot manifest 类型：启动真实 shell 正是该
harness 的用途，且这两个包本来就在 Host 图中。chat 场景则在 `support.ts` 中镜像
`conversationContextKey`，而不 import 其 Client owner。

没有任何机制强制这条规则；靠 review 守住它。
