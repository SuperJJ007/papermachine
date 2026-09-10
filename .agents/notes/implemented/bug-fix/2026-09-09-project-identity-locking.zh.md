# Agent Note: 跨进程串行解析项目身份

Status: implemented

[English](2026-09-09-project-identity-locking.md) | 中文

## Problem

并发打开可能同时读到工作区标记不存在，并为同一目录分配不同项目 ID。并发替换元数据也可能在 SQLite 串行处理产物追加之前触发 Windows `EPERM`。仅靠原子替换无法串行化读取、判断和写入操作。

## Decision

项目身份解析在读取工作区标记之前持有该标记的跨进程写锁。标记已存在时，还需在读取记录路径并判断重开、移动或复制之前持有项目记录的写锁。锁顺序始终为工作区、项目；检查另一个工作区的标记时不获取其锁。新项目 ID 拥有独立存储目录。

## Alternatives considered

重试失败的重命名无法防止重复身份或竞争的移动判断。进程内互斥锁无法协调独立 Host。全局注册表锁会串行化无关工作区。现有 atomic-write 锁提供有界竞争等待和孤立锁明确报错，无需另造锁实现。

## Consequences

并发首次打开共享同一身份，已删除工作区的多个存留副本不能全部认领其移动身份。标记和存储记录仍是分别原子替换的文件，因此不承诺两个文件之间的崩溃原子发布。SQLite 继续按[项目存储决策](../architecture/2026-08-26-project-artifact-store-s1.zh.md)管理产物版本顺序；元数据加锁补充该机制。

## Verification

并发首次打开和移动/复制回归验证身份归属。真实操作系统进程重开同一存储并追加版本。可运行的 Science 快照在生成产物前并发打开工作区，并在冷读历史时验证只有一个项目身份。

## 相关决策

相关 owner：[project-artifact-store](../architecture/2026-08-25-project-artifact-store.zh.md); [project-artifact-store-s1](../architecture/2026-08-26-project-artifact-store-s1.zh.md).
