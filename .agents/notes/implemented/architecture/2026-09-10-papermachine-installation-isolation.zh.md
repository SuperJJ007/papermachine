# Agent Note: PaperMachine 安装数据隔离

Status: implemented

[English](2026-09-10-papermachine-installation-isolation.md) | 中文

## 问题

本地构建的 Science CLI 即使使用独立的程序和依赖，仍可能继承官方 DSH 数据目录。持久化的 Science 默认值随后会进入不提供该预设的官方应用。安装了两个产品的电脑还需要独立的桌面浏览器存储和单实例锁。

## 决定

PaperMachine 入口在加载 profile 或应用插件前解析数据目录。共享路径包负责产品选择：显式启动路径、`PAPERMACHINE_HOME`、保存绝对路径的 `~/.papermachine-home` 指针，最后是当前用户的 `~/.papermachine`。继承的 `DSH_HOME` 不决定产品目录。规范化路径不得与官方 `~/.dsh` 重叠，包括经由现有符号链接的别名。产品将结果作为 `DSH_HOME` 传给[统一 Harness 主目录解析器](2026-07-24-single-harness-home-resolver.zh.md)所述的现有运行时机制。

本地 CLI 在启动、插件管理或配置转储前，为具名的 `science` 和 `science-headless` profile 应用该选择。仓库命令直接调用此 CLI。普通 DSH profile 保留原有行为。桌面端在取得单实例锁前设置 PaperMachine 的 Electron 名称和浏览器存储，并将解析后的目录显式传给活跃和暂存 Host 进程。开发启动使用独立的工作树目录，除非指定 PaperMachine 覆盖值。安装后的运行时资源仍来自内置 Node、私有 Host 和绑定版本的包 seed。

发布打包使用现有 `com.papermachine.desktop` 应用 ID、`PaperMachine` 产品名称和 `papermachine-` 产物名称。只有 `PAPERMACHINE_DESKTOP_APP_ID` 可以覆盖应用 ID。生产构建要求 `PAPERMACHINE_DOWNLOAD_ORIGIN`；测试构建保留 `DOWNLOAD_TEST_ORIGIN`。两者都拒绝官方下载主机，并使用 `_/papermachine/desktop/stable/<target>/`。所选更新 URL 嵌入应用，安装时无需用户配置环境。这些产品选择替代 [Electron 桌面打包与更新](2026-08-25-electron-desktop-packaging-and-updates.zh.md)中的共享目录与固定 origin 选择；其中签名 seed、暂存和发布验证的决定继续适用。

## 考虑过的替代方案

**修改官方默认值。** 这会影响另一个安装。仅选择 profile 或端口仍会共享用户设置和 home 级补丁。

**继承或复制官方状态。** 将继承的 `DSH_HOME` 作为产品后备值，会让为官方 DSH 配置的 shell 静默重定向 PaperMachine。整体复制旧设置还会带入无效预设和插件。显式产品选择器保留已保存的 PaperMachine 位置，不导入官方状态。

## 后果

全新安装使用可移植的用户相对位置，并保留空格和 Unicode。迁移验收指定可丢弃的 `PAPERMACHINE_HOME`，不写入已安装的数据。保存的位置无效时直接报错，不会静默创建全新安装。该选择不迁移历史 Science 日志，也不提供 Python/R 环境配置。会话转录不变；文件系统和真实进程入口检查负责该启动行为。
