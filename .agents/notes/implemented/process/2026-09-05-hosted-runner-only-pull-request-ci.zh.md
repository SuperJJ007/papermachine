# Agent Note: Hosted-runner-only pull-request CI

Status: implemented

[English](2026-09-05-hosted-runner-only-pull-request-ci.md) | 中文

## 问题

本仓库是一个 fork，发布为独立的私有 GitHub 仓库,它原样继承了上游项目的 [CI](../../../../.github/workflows/ci.yml)、[CI master](../../../../.github/workflows/ci-master.yml)、[e2e](../../../../.github/workflows/e2e.yml)、[release](../../../../.github/workflows/release.yml) 和 [release-vendor](../../../../.github/workflows/release-vendor.yml) 工作流。这些工作流假定了只有上游项目才有的基础设施:`ci.yml` 的四个主要任务选择了企业级 runner 标签 `dsh-ubuntu-24-04-16core` 和 `dsh-windows-2025-16core`,并带有由 `vars.DSH_CI_FAILOVER_*` 控制的、回退到自建 self-hosted 资源池的机制([CI failover runbook](2026-07-26-ci-failover-runbook.zh.md));`e2e.yml` 在每个 pull request、push 以及每夜定时任务上触发,并要求仓库密钥 `DEEPSEEK_API_KEY_EXTERNAL`;`release.yml` 和 `release-vendor.yml` 在每个 pull request 上打包 npm 包家族;`ci-master.yml`、`sandbox.yml` 和 `landlock-run.yml` 在 `push: branches: [master]` 上触发,而本仓库的默认分支(`main`)从不产生 `master` 分支上的 push。本仓库既没有那些企业级 runner、self-hosted 资源池、`DEEPSEEK_API_KEY_EXTERNAL` 密钥,也没有 `master` 分支,因此受影响的任务要么永远排队,要么直接失败,`all-checks-passed` 在真实的 pull request 上从未通过。

## 决定

`ci.yml` 中读取 `vars.DSH_CI_FAILOVER_LINUX` / `vars.DSH_CI_FAILOVER_WINDOWS` 的五处 runner 选择表达式改为纯字面量 `ubuntu-latest`(三个必需的 Linux 任务与 `all-checks-passed` 验证任务)或 `windows-latest`(`windows-native`);每一处已失效的 failover 分支——缓存恢复的 `if:` 条件、failover 专用的 Playwright 安装步骤,以及 `DSH_SNAPSHOT_MAX_CONCURRENCY` 的三元表达式——连同描述企业级/self-hosted 拓扑的注释一并删除。`windows-native` 唯一保留的 Windows 专属说明是:在托管 runner 上,一次干净安装比恢复多文件的 pnpm store 缓存更快。`pnpm run check:ci:static`、`check:ci:coverage`、`check:ci:consumers` 和 `check:ci:windows-complete` 继续以相同的 `DSH_GATE_CONCURRENCY` 和 `DSH_COVERAGE_*` 预算把关同样的命令;改变的只是 runner 资源池。

`e2e.yml` 现在只保留 `workflow_dispatch:` 作为触发方式。`on:` 上方的注释说明:在仓库密钥 `DEEPSEEK_API_KEY_EXTERNAL` 出现之前,push、pull-request 与每夜触发都保持关闭,恢复它们只需在 `on:` 中加回一行;任务级 `if:` 与预检密钥检查保持不变;针对 `pull_request_target` 的安全警告继续保留,供触发方式恢复时参考。

`release.yml` 和 `release-vendor.yml` 各自只保留 `workflow_dispatch:`,并附一行注释说明本仓库不在 pull request 上发布 npm 包家族,因此两个工作流仍然像之前一样,只能从 `dsh-v*` / `vendor-*` 标签通过各自的 `-publish.yml` 工作流手动运行。

`ci-master.yml` 去掉了 `push` 触发方式,保留 `workflow_dispatch` 及其 `suite` 输入不变,并附一行注释说明串行待命演练与两个基准测试套件都需要本仓库没有的 self-hosted runner。它的 `wine-apt-cache`、`serial-linux-selfhosted` 和 `serial-windows` 任务保留原有的 `if: github.event_name == 'push' && github.ref == 'refs/heads/master'` 条件未做修改,因此它们现在处于休眠状态——既触达不到已移除的 push 触发,也触达不到 `workflow_dispatch`——直到本仓库同时恢复 push 触发方式,以及这些任务所依赖的 self-hosted `vm-backup`/`dsh-win-ci` 资源池。当前只有 `larger-runner-benchmark` 和 `consolidated-runner-benchmark` 仍可触达,它们以 `workflow_dispatch` 加匹配的 `inputs.suite` 为条件。

`sandbox.yml` 和 `landlock-run.yml` 把 `push: branches:` 的目标从 `master` 改为本仓库真正的默认分支 `main`,其余触发方式、`paths` 过滤条件与任务体均未改动。

`.github/AGENTS.md` 与 `scripts/ci-workflow.spec.ts` 也相应更新:规格文件中对 `ci.yml`/`ci-master.yml` 的断言去掉了全部 `DSH_CI_FAILOVER_*`/企业级标签检查,改为断言纯字面量的托管 `runs-on` 值;新增的断言钉住了 (a) 除 `ci-master.yml` 外没有任何工作流文件引用 `dsh-ubuntu-24-04-16core`、`dsh-windows-2025-16core`、`dsh-win-ci`、`vm-backup` 或 `DSH_CI_FAILOVER`,而 `ci-master.yml` 中匹配的任务只能通过 `workflow_dispatch` 触达;(b) `e2e.yml`、`release.yml`、`release-vendor.yml` 和 `ci-master.yml` 各自唯一的触发方式都是 `workflow_dispatch`;以及 (c) 没有任何工作流的 `push.branches` 包含 `master`。

## 考虑过的替代方案

**把 failover 选择表达式重新指向本仓库自建的 self-hosted 资源池。** 目前否决:本 fork 中没有任何人运维上游 failover 机制所假定的那些常驻 VM 或 Windows runner 集群,搭建它是一项比"让 pull-request CI 能够通过"大得多、独立的工程。

**直接删除处于休眠状态的 `ci-master.yml` 待命任务,以及 `2026-07-26-ci-failover-runbook.md` 这份 Agent Note,而不是让它们保持休眠。** 否决:本次改动的范围是让 pull-request CI 在托管 runner 上通过,而不是重新设计 master/串行待命拓扑。保留这些任务自身的 push 门控 `if:` 条件,恰好记录了未来恢复 push 触发方式时需要满足的确切条件;删除它们会连同仍然有效的任务与理由一起抹去这个脚手架,一旦本仓库将来重新拥有假定的 runner,它们依然可用。按照本次改动中"不编辑既有 Agent Note"的既定规则,failover runbook 本身未做修改;它现在描述的机制在现存工作流文件中并不存在,直到未来某次改动要么恢复企业级资源池的 failover,要么将该 runbook 归档。

**为 `e2e.yml` 恢复自动触发方式,并对缺失的密钥做软失败处理,而不是仅保留 `workflow_dispatch`。** 否决:预检步骤本就设计为在密钥缺失时硬失败,因此它会在每个 pull request 上失败,而不是单纯不运行;把这道防线降级为容忍密钥缺失,会在密钥将来真的在别处配置好的那一天,掩盖一次真实的配置错误。

## 后果

目前 pull-request CI 能够满足的每个任务,现在都能在纯字面量的 GitHub 托管 runner 上完成,因此 `all-checks-passed` 首次能够在本仓库的真实 pull request 上通过。`e2e.yml`、`release.yml`、`release-vendor.yml` 以及 `ci-master.yml` 的基准测试套件,只能由维护者手动触发;目前没有任何机制会自动运行真实 API 的 e2e 套件、打包发布 tarball,或对更大的 runner 做基准测试。`ci-master.yml` 的 `wine-apt-cache`、`serial-linux-selfhosted` 和 `serial-windows` 任务已被该工作流现有的任何触发方式触达不到——要恢复它们,既需要重新引入 `push`(或其他能满足其 `if:` 条件的触发方式)的决定,也需要它们所演练的那些 self-hosted 资源池。`sandbox.yml` 和 `landlock-run.yml` 恢复在每次 push 到本仓库真正的默认分支 `main` 时运行。将任何仅手动触发的工作流恢复为自动触发,或恢复已移除的 failover 机制,正如保留下来的注释所说,都只需要对相应工作流的 `on:` 块及其 runner 选择表达式做一行改动。
