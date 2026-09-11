# Agent Note: kernel 范围的用户安装目录，让 inline `pip install`/`install.packages()` 真正生效

Status: implemented

[English](2026-08-22-science-kernel-scoped-inline-installs.md) | 中文

## 问题

内联 pip 与 R 安装需要可写库，但不能修改共享绑定 prefix，也不能把包泄漏到后续内核 epoch。

## 决策

内核 scratch 拥有 Python `PYTHONUSERBASE` 与 R `R_LIBS_USER`；R 库目录在启动前创建。Python 内核允许 user site，环境探测仍保持隔离启动。Driver 在允许 user-site 加载时创建嵌套目录并调用 `site.addsitedir(site.getusersitepackages())`：仅在 Python site 初始化后创建父目录，不会把最终叶目录加入 `sys.path`。

这些库属于内核 epoch。耐久包安装仍是针对绑定 prefix 的独立 micromamba 操作。

## 考虑过的替代方案

**把内联包装入共享 prefix。** 会改变其他会话环境，却没有记录所请求的耐久修改。

**整段会话保留 scratch 库。** 重新绑定后可能导入为另一解释器安装的包。

**只设置 PYTHONUSERBASE。** Python 初次构建导入路径时，带版本的 site-packages 目录可能还不存在。

## 后果

替换内核会丢失内联包，它们不属于环境锁或包摘要。探测保持隔离，避免内核私有包让无效 profile 显得健康。

## 相关决策

相关 owner：[science-persistent-kernel](2026-08-20-science-persistent-kernel.zh.md); [science-package-install](../feature/2026-09-01-science-package-install.zh.md).
