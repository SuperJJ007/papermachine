# DSH Science 浏览器持久化内核与产物版本冒烟证据

[English](2026-08-20-dsh-science-browser-persistent-kernel-smoke.md) | 中文

本次调查于 2026-08-20 在 macOS 26.5.2（Darwin 25.5.0，arm64）和用户已有的 Chrome 会话中进行。源码 Web 应用从 DSH checkout `5bcd3f6fb7406c176262dd17bd4616a243475f79` 启动并服务于 `http://127.0.0.1:3081/`；选中的 Science 会话是「本地数据绘图演示」。本记录是有日期的浏览器与源码快照，不是发布验收。

## 结论

Python 持久化内核通过了跨轮次状态、普通执行异常、安全用户取消和浏览器刷新四项浏览器检查。观察到的每次 Python run 都使用 `kernelEpoch: 1`，每个边界之前写入的值都能在边界之后继续读取。

产物版本分配失败。两个不同用户轮次向同一逻辑产物写入了不同字节，但两个工具行与 Details Viewer 都报告 v1；持久化投影只保留了带有较新字节的一个版本。会话原有 PNG 也呈现同一缺陷：修改后的图仍是 artifact v1，而已发布 Outcome 已递增到第 2 版。

取消还存在展示不一致。持久化 Science run 是 `cancelled`，并带 `failureCode: CANCELLED`，但 Chat run 卡片显示「运行失败」与 `Error: tool call aborted`，没有使用已有的中止状态。

## 身份与范围

| 层级 | 身份 | 范围与结果 |
|---|---|---|
| DSH 源码 | `5bcd3f6fb7406c176262dd17bd4616a243475f79` | 源码检查与从源码启动的 Web 进程；没有改动既有的三个未跟踪 Claude Science 调查文件 |
| Web Host | `127.0.0.1:3081`、Node `v24.14.0`、pnpm `11.7.0` | 既有源码进程；没有重启 Host、安装 package 或改变环境 |
| 浏览器 | 用户已有的 Chrome 标签页 `http://127.0.0.1:3081/` | 在选中的 Science 会话中进行真实模型与工具交互 |
| Science 环境 | revision 1；Python 3.12.12；指纹前缀 `cf808732c543` | Python 可用；当前会话的 R 不可用 |
| 发布层级 | 无 | Desktop 打包、安装器、签名、发布、tag、release 与其它平台均为 `NOT-RUN` |

浏览器测试只在每个 run 的 `SCIENCE_ARTIFACT_DIR` 中创建或重写 `kernel_browser_probe.txt`。它没有编辑仓库产品源码、workspace 文件、Science 设置、Conda prefix、凭据、Git ref 或发布状态。

## 浏览器观察

| 检查 | 浏览器操作与持久化证据 | 结果 |
|---|---|---|
| Python 跨轮次状态 | Run `c1e63b77-3522-4546-8eef-d1ed67e7895f` 设置 `kernel_browser_probe = 41`；下一用户轮次的 run `76d0665f-acac-4154-be75-ee5227a98f5d` 在没有重新定义变量的情况下执行 `kernel_browser_probe += 1`，并输出 `KERNEL_BROWSER_PROBE=42`。两次 run 都使用 `kernelEpoch: 1`。 | **PASS** |
| 跨轮次产物版本 | 两次 run 分别向 `kernel_browser_probe.txt` 写入 `41` 和 `42`。两个工具行都报告 v1。`get_science_state` 只暴露一个产物：`67eaf886-882f-46d8-8259-5c1d692d3ef3` v1，归属于后一 run；Details Viewer 显示 `42`、v1，上一版本与下一版本按钮均禁用。 | **FAIL** |
| 普通异常后的存活 | Run `235876ff-2061-4ba3-813e-c3b8eafa9964` 先赋值 `kernel_browser_survivor = "alive"`，再抛出 `RuntimeError("kernel-browser-probe")`；它持久化结束为 `failed/EXECUTION_FAILED`。下一 run `0cbd31bf-96b0-426c-b84d-ce9294bdcdfd` 输出 `SURVIVOR=alive`，仍处于 epoch 1。 | **PASS** |
| 用户取消后的存活 | Run `de26dbc1-ba04-486a-b4b6-af0eb0f91311` 设置 `kernel_browser_cancel = 73`，输出 `CANCEL_PROBE_STARTED` 后 sleep。点击「停止生成」产生 epoch 1 上的持久化 `cancelled/CANCELLED` terminal。Run `e97287fe-9f43-4f2e-9512-a0a6f03ab3c3` 随后在 epoch 1 输出 `CANCEL_SURVIVOR=73`。 | 内核状态 **PASS**；展示问题见下文 |
| 浏览器刷新后的存活 | 刷新 Chrome 页面后，run `52971c9a-3c1c-4c2c-ba1e-199d2e7f0aab` 输出 `RELOAD_PROBE=42|alive|73|11`；内核仍以 epoch 1 存活。 | **PASS** |
| Python/R 共存与隔离 | Python 设置并输出 `language_isolation_probe = 11`。`run_r` 在建立 run 之前以 `Science r environment is not available` 被拒绝。 | R 为 `NOT-RUN`；这是会话配置缺失，不是已证明的 Runtime 失败 |

展开后的 `get_science_state` 结果报告 17 次 run、一个 epoch 1 的存活 Python 内核、两个逻辑产物、两个总产物版本和第 2 版 Outcome。第一次和第二次文本产物 run 的 `toolCallId` 不同，但 `requestHeaderSeq` 都是 14。

## 问题 F1：把 request header 当成了用户轮次身份

严重度：**P1 产品缺陷**。当 provider、model、tools 与 system 配置不变时，一次普通后续请求无法开启下一个可见产物版本。

浏览器证明了需要区分的两个身份。Run `c1e63b77…` 与 `76d0665f…` 来自两条已提交的用户消息，工具调用不同，却都携带 request header 14。同一逻辑文件从 `41` 变成 `42` 后，投影与 Viewer 仍只有 v1。之前的图表编辑症状相同：`gpt_exposure_wage_bubble.png` 仍为 artifact v1，但 Outcome 已是第 2 版，并引用后一 run `9e2f7c18-e538-4bc9-915b-23647f530fb9`。

源码解释是直接的。[`capture.ts`](../../packages/science/science-runtime/src/capture.ts) 只在 `latest.requestHeaderSeq !== sourceRun.requestHeaderSeq` 时递增版本。[`agent.ts`](../../packages/core/agent-loop/src/agent.ts) 只在 initial/resume 或 canonical request 配置改变时提交 `request/header`，所以该 sequence 标识配置 epoch，而不是每个用户轮次。[`harness.ts`](../../packages/science/science-runtime/tests/harness.ts) 每次授权 run 都追加新的 `request/header`，因此掩盖了缺陷。

修复应解析旧产物与新 source run 各自所属的 `tool/call.turn`，再比较两个 turn。[`fold-state.ts`](../../packages/science/science-session/src/fold-state.ts) 已经以 `turn` 和 `step` 索引每个工具调用；Runtime allocator 与 [`transition.ts`](../../packages/science/science-session/src/transition.ts) 中的 supersede 校验必须使用同一规则。`requestHeaderSeq` 仍是有效溯源字段，但不能决定可见版本身份。

修复需要一份新的 bug-fix Agent Note，因为已实现的[按请求划分产物版本决策](../../.agents/notes/implemented/architecture/2026-08-19-artifact-version-per-request-turn.md)当前把 `requestHeaderSeq` 称为轮次锚点。修复应保留它的产品规则——同一轮次 supersede、后续轮次递增——同时纠正实现该规则所使用的持久化关系。

必需的回归证据：

- 只有一条 `request/header`、两个不同 `tool/call.turn`，且两次 run 向同一逻辑名写入不同字节时，必须得到 v1 与 v2。
- 同一工具调用轮次中的两次 run 仍须 supersede v1，不能开启 v2。
- 即使两个调用共享同一 request header，严格 replay 也必须拒绝跨轮次 supersede，并接受同轮次 supersede。
- 一个 keyless assembled Web 或 snapshot 场景必须提交两个用户轮次，并在 run 行与 Details Viewer 中显示 v1/v2，上一版本与下一版本导航可用。
- 受影响包测试、keyless 产品 snapshot、若 loop 预期输出变化则包括两个 SDK projection、文档、由 pre-push 工作流选择的 typecheck/build 层级，以及 `git diff --check` 必须分别报告；focused unit PASS 不等于浏览器或发布闭环。

## 问题 F2：持久化为 cancelled，却展示为 failed

严重度：**P2 Trace 与状态缺陷**。它没有丢失内核状态，但在 Agent Trace 最需要解释的交互上给用户显示了错误的生命周期标签。

页面执行停止操作后，Chat 行显示「运行失败」和 `Error: tool call aborted`。展开后的 Science state 把同一 run 标识为 `status: cancelled`、`failureCode: CANCELLED`、`kernelEpoch: 1`；后续成功运行证明安全中断保留了内存。

[`ScienceToolFallbackRow.tsx`](../../packages/client/ui-science/src/client/ScienceToolFallbackRow.tsx) 仅把 `block.error.code === 'interrupted'` 映射为 `stopped`，其余 error tool result 全部变为 `error`。工具执行器的 canonical post-dispatch abort result 在 error info 中携带 `AbortError` 和 canonical abort code，而可见纯文本是 `Error: tool call aborted`。修复应让标准化的持久化调用切片区分用户停止与执行失败，并明确保留 dispatch 之前取消的通用行为。

应添加一条浏览器级取消回归：在 `run_python` 活跃时点击真实停止控件，断言 Science run 卡片使用中止展示，并独立断言持久化 run 仍为 `cancelled/CANCELLED`。现有针对 synthetic `interrupted` error 的组件测试没有覆盖本次观察到的 wrapper-abort result。

## 剩余持久化测试矩阵

以下项目在本次浏览器测试中刻意保持 `NOT-RUN`，仍适合作为两个缺陷修复后的验收工作：

- 使用明确配置的真实 Conda R prefix 测试真实 R 持久化与 Python/R 共存。
- Host 重启：旧 process 内存必须消失，replay 不得把旧 kernel 显示为存活，下一次 run 必须使用更大的 epoch。
- idle timeout retirement 与随后更大的 epoch。
- 产品路径能够应用更高 environment revision 后的 environment rebind retirement。
- per-run timeout 的两条路径：已证明安全的中断继续复用，以及污染内核的 `run-escalation` retirement。
- Session 隔离：两个 Science session 中的同名变量不能共享内存。
- Kernel crash 与 wire-protocol failure，包括持久化退出原因和下一 epoch 恢复。
- 通过 `pnpm --filter @deepseek-ai/dsh-science-runtime run test:real-acceptance` 执行真实 Conda 验收；它与本浏览器证据属于不同层级。

## 交接边界

本次调查只改动这对双语证据文档及其配对记录。它没有实现任何修复、添加 Agent Note、修改测试、重启 Host、配置 R、运行 real-acceptance、stage、commit、push、创建 PR、publish 或 release。
