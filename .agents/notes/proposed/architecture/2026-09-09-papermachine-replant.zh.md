# Agent Note: PaperMachine 移栽至 dsh 0.1.5

Status: proposed

[English](2026-09-09-papermachine-replant.md) | 中文

## Problem

PaperMachine 依赖分支独有的会话、子进程、RPC 和浏览器 API，与 dsh 0.1.5 的实现不同。合并两套实现会保留过时的应用组合，并重复已有公开扩展机制。

## Proposal

以已批准的 0.1.5-alpha.1 树为基线，移入八个 PaperMachine 包。包版本跟随 dsh，产品发布版本独立。science-app bundle 和 science profile 拥有产品组合。RPC、侧栏资源和会话存储采用目标 API。旧 V0 会话保留在磁盘，在另行实现迁移前明确拒绝读取。

源码移入不等于验收。P1 要求可运行的品牌 profile、编译和依赖检查，以及每个临时 stub 的明确归属。Host 行为归 P2/P3，侧栏归 P4，桌面组合归 P5。不得仅为让移入源码编译而将缺失的 API 恢复到上游包。

P1 源码占位实现会明确拒绝启用或执行。原实现可从导入检查点恢复；占位实现不伪造投影、子进程句柄、附件回执或浏览器注册。Host 源码和测试仍纳入编译程序。已禁用的 ui-science 的 Client 引用和测试暂缓至 P4；P4 第一步须恢复两者，再适配 UI，避免过时 UI API 的错误掩盖 P2/P3 的 Host 编译诊断。逐项交接清单由迁移记录维护。

## Alternatives considered

合并旧分支会保留已删除的 runtime 和 Detail 面板机制。树外产品无法向静态会话目录添加必需的 Science 事件类型。这两种方案均不符合已批准的目标架构。

## Acceptance criteria

每阶段独立提交并记录检查。编译或品牌 profile 验收失败时，不得报告 P1 完成。替换 main 前，仍须完成运行时、会话格式、浏览器、桌面和集成验收。

## Risks

如果临时 stub 的归属及拒绝行为不清楚，就可能掩盖尚未完成的迁移。运行时和 UI 代码须通过对应阶段检查后才算验收。移栽前的 main 和用户会话原文件保持可用。
