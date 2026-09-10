# Agent Note: Science 录制会话回放

Status: implemented

[English](2026-09-10-science-recorded-session-replay.md) | 中文

## Problem

Science 将环境观测、内核时钟和产物身份同时写入持久事件与模型可见状态。独立运行无法按字面比较机器相关的值，但删除整个载荷会掩盖绑定错误及用户所见产物的变化。私有可执行驱动也无法检验发布的 profile。

## Decision

[无界面适配器](../../../../snapshots/session/headless.snapshot.ts)通过独立应用目录与包内精确操作内核 fixture 驱动发布的 Science profile。真实 API 录制保留完整模型轮次；回放替换模型提供者和昂贵的解释器进程，生产工具管道、运行时、访问限制及内容寻址存储正常执行。解释器拒绝不同的 Python 源码，而非接受任意请求程序。

[Science 归一化](../../../../packages/test-support/session-snapshot/src/science.ts)仅处理明确由服务拥有的字段。权威事件为解释器位置、可执行文件身份、环境指纹和 scratch key 分配保留关系的 token。结构化状态结果及具名运行时上下文段使用相同映射。不清除语义内容或未知事件。环境引用不一致、哈希变化、版本变化和输出大小变化仍可观察。

[Web 预设回放](../../../../apps/web/tests/science-preset.snapshot.ts)比较完整持久 Session 与渲染的会话。冷恢复明确将录制的存活内核转为已中断内核；产物、环境、运行与指标的一致性单独检查。非会话图表预览与投影 expected 保留在所属运行时包或 Web 测试中。[快照包](../../../../packages/test-support/session-snapshot/README.zh.md)拥有操作细节。

## Alternatives considered

**按字面录制环境：**解释器路径、文件系统身份和时钟读数使相同操作在不同机器及临时应用目录中产生差异。

**广泛替换文本或删除事件：**这可能抹去用户文本、错误身份引用、产物哈希及运行时失败。仅归一化识别出的 Science 字段与其所属投影。

**通过旧可执行驱动回放：**它省略公共 profile 的预设挂载和应用目录选择。发布的 CLI 与标准 Web scaffold 保留为受测应用路径。

## Consequences

无密钥场景证明组装后的 Science 会话、不可变版本复用、存储 PNG 字节及冷恢复和浏览器恢复。它们不证明解释器兼容性或平台访问限制；生产内核的真实验收仍独立进行。新的录制 Python 操作需要显式更新 fixture，并独立验证输出字节。既有通用快照归属与 Web 回放决策保持有效；本记录补充 Science 专有归一化和解释器 fixture 约束，不取代它们。
