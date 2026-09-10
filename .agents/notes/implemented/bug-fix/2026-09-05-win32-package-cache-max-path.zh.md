# Agent Note: Windows 上的 micromamba package cache 保持在 MAX_PATH 之内

Status: implemented

[English](2026-09-05-win32-package-cache-max-path.md) | 中文

## 问题

Windows 包缓存路径包含配置根及很长的包内路径。产品 home 可写不代表不会遇到 MAX_PATH。

## 决策

Windows provisioning 使用 `resolvePackageCacheDir` 选择的短 `<SystemDrive>\pm\pkgs` 缓存根。产品环境和包缓存有不同位置要求；移动用户 home 不会缩短所有解压路径。即使测试在另一 Host 检查，路径计算仍使用 Windows 语义。

## 考虑过的替代方案

**把缓存放在深层用户 home 下。** 长归档成员可能耗尽剩余路径预算。

**假设启用长路径就能修复所有解压器。** 每个参与的可执行文件都必须支持。

**无限缩短根目录。** 镜像域名及未来包成员也消耗预算，节省几个字符不是长期保证。

## 后果

短根降低风险，不保证所有包都能放下。镜像选择有独立测量失败及重引入条件。保留当前源码理由不表示 Windows 安装已验收；缓存共享、权限及实际打包程序仍需平台验证。

## 相关决策

相关 owner：[win32-package-cache-tuna-max-path](2026-09-07-win32-package-cache-tuna-max-path.zh.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.zh.md).
