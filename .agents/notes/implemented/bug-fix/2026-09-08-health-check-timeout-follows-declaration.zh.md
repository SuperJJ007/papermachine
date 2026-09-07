# Agent Note: 环境 health check 改用声明自己的超时，不再是一个隐藏的 120 秒上限

Status: implemented

[English](2026-09-08-health-check-timeout-follows-declaration.md) | 中文

## Problem

B3（`.agents/tmp/2026-09-07-win32-crt/B3-mac-x64-rosetta-smoke.md`）在 Apple Silicon 上用 Rosetta 跑打包好的 `0.1.1` x64 `.app`：`general` 环境的 323 个包全部下载并 link 成功（TUNA 失败后由 USTC 完成安装），紧接着"校验 Python 与 R"阶段以 `desktop provisioning: timed out` 失败。`applied.json` 从未生成，onboarding 卡在错误页，除了重新走一遍整个安装之外没有别的路。这个已置备的环境本身没有损坏——它的 Python、R 解释器与各个包在磁盘上都完好。

`apps/desktop/src/provisioning.ts:971` 给每一条 health check 的超时都是 `Math.min(declaration.timeoutMs, 120_000)`，不管 `declaration.timeoutMs` 实际声明了多少；而上面几行的 `create` 步骤直接用的是 `declaration.timeoutMs`。`general.json` 的 health check 是 `import numpy,scipy,pandas,matplotlib,seaborn,statsmodels,sklearn,pyarrow,openpyxl,pyreadstat,PIL`（Python）与 `library(tidyverse);library(haven);library(lme4);library(survey);library(data.table)`（R）——是真实的工作负载，不是仓库里别处轻量 fixture 用的那种 `python -c pass`。

## 实测数据

在 B3 那次运行留下的、完好的 x64 环境上（Apple Silicon，Rosetta），把每条 health check 的原样命令连续跑两次：

| 检查 | 首跑 | 二跑 |
| --- | --- | --- |
| Python（`import numpy,scipy,pandas,matplotlib,seaborn,statsmodels,sklearn,pyarrow,openpyxl,pyreadstat,PIL`） | `3:49.96` total | `1.98s` |
| R（`library(tidyverse);library(haven);library(lme4);library(survey);library(data.table)`） | `20.1s` | `1.4s` |

首跑的开销来自 x86_64 原生扩展在 Rosetta 下的一次性 AOT 转译；转译完成后同一个进程快了两个数量级。真 Intel 机没有 Rosetta 转译这一步，但冷盘、老机器、或是 Windows Defender 对数千个新写入的 `.pyd`/`.dll` 文件做实时扫描，出于同样的底层原因同样可能把首次 import 拖到两分钟以上——这些都没有在 `resources/environments/*.json` 里的任何地方被声明或配置，因此一次部署没有办法按自己真实的首次 import 开销去设置 health check 的超时。

## Decision

health check 改用 `declaration.timeoutMs`——与 `create` 步骤已经在用的是同一个字段——不再是 `Math.min(declaration.timeoutMs, 120_000)`。`EnvironmentDeclaration.timeoutMs` 的 JSDoc（`apps/desktop/src/environment-declaration.ts`）现在写明它同时约束这两个阶段。基于 `abortController` 的取消不受影响：调用方仍然可以在任意时刻取消一个卡住的 health check，不需要等满 `timeoutMs`，所以一个真正挂死的解释器实际最坏情况是一次显式取消，不是等上数小时。

## Alternatives considered

- **在 `EnvironmentDeclaration` 上新增一个必填字段 `healthCheckTimeoutMs`。** 已否决：每一份声明都经过同一个 `environment-declaration.ts` parser，用户持久化的 `<dshHome>/desktop-environments/custom.json` 也走这同一个 parser；新增必填字段会让磁盘上所有已存在的 custom 声明解析失败，而不只是改变新写的声明的行为。
- **用一个更长的固定常量（例如 10 分钟）取代 120 秒。** 已否决：这仍然是一个 `resources/environments/*.json` 里任何地方都没有声明的隐藏上限，也没有解决根本问题——更慢的磁盘或更重的包集仍然可能超过任何一个没有实测依据就选定的固定数字，这正是 `Math.min(declaration.timeoutMs, 120_000)` 已经犯过的错误。`general.json` 已经为 `create` 步骤自己的最坏情况声明了 `timeoutMs: 3600000`；health check 复用它不需要额外的配置成本。

## Consequences

一次在慢盘、未转译的 Rosetta 二进制、或正被杀毒软件主动扫描的 Windows 机器上跑的 health check，现在最多能拿到 `declaration.timeoutMs`（`general.json` 是 3600000 ms），不会在解释器其实还在正常工作时就于 120 秒处失败。`apps/desktop/tests/provisioning.spec.ts` 断言两条 health check 收到的 `timeoutMs` 远大于旧上限（3,600,000 ms），而不是一个更短的值，所以退回固定上限会让这条测试失败。
