# Agent Note: Science 上下文重复与 run 目录指引

Status: implemented

[English](2026-09-04-science-context-churn-and-run-directory-guidance.md) | 中文

## 问题

按变化追加的运行时上下文可能仅因运行状态变化，就重复添加整份环境快照。每次运行目录和版本相关库字段也容易造成可避免错误。

## 决策

环境上下文依赖 mode、环境及解释器事实，而不依赖最新运行。运行结果及显式状态读取提供状态。因此普通运行不会仅因状态变化就产生新的环境文本。

指导区分全新 `SCIENCE_ARTIFACT_DIR` 输出、内核变量及 `SCIENCE_STATE_DIR` 工作数据。精确产物输入在独立目录物化，工作区访问使用声明路径。库结果参考要求索引陌生结果前打印列名或 R 结构。记录的 pingouin/scipy/statsmodels 示例是特定版本观察。

## 考虑过的替代方案

**把运行状态移到另一条按变化追加的上下文。** 仍会每次运行产生重复。

**添加重叠目录指导而不改写原 owner。** 增加固定 prompt 成本并可能留下冲突指令。

**凭记忆填写库列名。** 版本变化正是参考要防止的错误。

## 后果

所拥有事实不变时，运行时上下文保持稳定。Artifacts 是最终交付物，不是持久中间工作区。静态库参考没有自动列名漂移门禁；升级交付依赖版本时须重新核对示例。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md); [science-runtime-input-materialization-and-edit-baselines](../feature/2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md).
