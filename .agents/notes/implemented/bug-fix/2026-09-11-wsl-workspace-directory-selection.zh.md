# Agent Note: WSL 工作目录选择保持 Host 文件系统语义

Status: implemented

[English](2026-09-11-wsl-workspace-directory-selection.md) | 中文

## 问题

WSLg 可能声明显示环境并安装 Linux 选择器，却无法向浏览器操作者展示可用的对话框。另一个问题是主目录祖先折叠后，文件系统根目录和挂载的 Windows 卷缺少导航入口。上游分别报告了 [WSL 对话框不可见](https://github.com/deepseek-ai/deepseek-harness/discussions/929)和[无法导航到挂载盘](https://github.com/deepseek-ai/deepseek-harness/discussions/2700)。

## 决策

自适应选择器在 Linux 继承了非空 `WSL_DISTRO_NAME` 或 `WSL_INTEROP` 时选择 browse。启动来源检查排除项目及用户 `.env` 的值。仍可显式组合原生选择器。当主目录隐藏根目录祖先时，浏览对话框提供文件系统根目录快捷入口，并为既有绝对路径编辑器显示文字标签。根目录取自 Host 列表，不合成盘符或挂载前缀。选择的路径原样交给工作区创建；持久身份继续由既有规范化逻辑管理。

## 考虑过的替代方案

信任 WSLg 显示标记会保留不可见对话框故障。猜测 `/mnt/c` 假设了默认自动挂载配置。将选定路径转换成 Windows 格式会混淆文件访问和执行环境选择。Windows 宿主应用访问 WSL UNC 目录时仍使用 Windows 运行环境；选中目录不代表支持 Linux 执行。

## 影响

该策略放弃 WSL 原生对话框，采用没有 WSLg 时也可用的浏览器交互。移除两个继承标记的环境必须显式组合 browse；不采用内核名称推断，因为容器可能共享 WSL 内核却没有其交互环境。决策测试覆盖两个标记、空值及原生 Windows。Loader 测试覆盖启动来源；仅限 Linux 的 WSL 用例继续按平台执行。组件及真实 Web 测试覆盖离开主目录、输入含空格的 Unicode 路径，以及工作区和会话目录身份。Windows 原生对话框验收与 WSLg 执行仍属于单独的平台证据。

现有 [Win32 字符串解码决策](2026-08-31-win32-picker-path-string-read.zh.md)继续管理 COM 分配及 Koffi 转换；本决策不替代它，也不将旧的自有缓冲区 PR 移植到当前解码器。
