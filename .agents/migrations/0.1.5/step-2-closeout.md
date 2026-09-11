# 工作目录选择修复收尾

日期：2026-09-11。工作树 `/Users/superjj/ccproj/pm-replant`，分支 `replant/0.1.5`。产品 PaperMachine 0.1.3，底座 dsh 0.1.5-rc.1。修复提交 `7aab4a0fc6`，本地提交，未推送。此前已验收改动的独立提交见[第 1 步收尾](step-1-closeout.md)。

## 已完成

- Linux 继承非空 `WSL_DISTRO_NAME` 或 `WSL_INTEROP` 时，自适应选择器使用浏览器交互，即使有 WSLg 显示与 zenity/kdialog。项目或用户 `.env` 不能伪造此启动事实；显式原生组合仍可选。
- 主目录面包屑折叠时显示“文件系统根目录”入口；“编辑路径”显示文字，支持 Host 的绝对路径、空格及 Unicode。根目录来自 Host，不猜测盘符或 `/mnt` 挂载位置。
- 真实 Web 场景从主目录进入文件系统根目录，再选择主目录外的中文空格目录，核对持久工作区路径和新会话 header.cwd。既有 shell 路由测试另行验证默认会话目录、绝对覆盖、相对路径及两个会话隔离。
- [旧 issue #5](https://github.com/SuperJJ007/papermachine/issues/5)及[未合并 PR #26](https://github.com/SuperJJ007/papermachine/pull/26)的故障涉及 `koffi.view`。当前实现已使用指针缓冲区与 `koffi.decode`，桌面 Host 使用独立 Node；保留现有实现。定向测试覆盖真实 Koffi 的中文、代理对、超过 32 KiB 的字符串及 NUL 终止，以及原生流程取消/重试。没有把这些测试宣称为 Windows 弹窗实机验收。

## 验证证据

命令均在适配工作树执行，Node 为 `/private/tmp/dsh-rc1-node/bin/node`。日志前缀为 `/private/tmp/pm-step2-`。

| 检查 | 结果 | 日志 |
|---|---|---|
| 新增决策及根目录组件回归，先运行旧代码 | 3 失败、93 通过，失败对应 WSL 两个标记和根目录入口缺失 | `negative.log` |
| `vitest run packages/host/directory-picker-auto/tests packages/client/ui-directory-picker-browse/tests packages/host/directory-picker-native/tests packages/host/directory-picker-browse/tests packages/client/ui-directory-picker-native/tests` | 192 通过、1 平台跳过 | `focused.log` |
| `vitest run packages/client packages/host` | 408 文件，5915 通过、2 平台跳过；包含后补的 Loader 来源测试 | `gui.log` |
| `vitest run packages/workspace/workspace/tests packages/api/workspace-controller/tests packages/shell/tool-bash/tests/tools.spec.ts` | 175 通过 | `workdir.log` |
| `vitest run --config vitest.web.config.ts apps/web/tests/workspace-management.e2e.ts` | `DSH_SNAPSHOT=refresh` 13/13，随后 `replay` 13/13 | `web-refresh.log`、`web-replay.log` |
| `node --import tsx/esm scripts/build.ts --profile papermachine` | 完整构建通过，238 客户端产物 | `build.log` |
| `node --import tsx/esm scripts/run-oxlint.ts .` | 通过；最终注释整理后另跑组件定向 lint | `lint.log` |
| `node --import tsx/esm scripts/run-gates.ts doc-sync` | 34/34 通过 | `doc-sync.log` |

完整构建使用 `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk`，并沿用第 1 步记录的 pnpm 路径和依赖验证设置。初次构建发现可选字段及异步断言类型错误，修正后通过。最终注释整理后重建 `build:lib:client` 与 `build:web`，重新记录 238 个产物，日志 `client-final.log`。所有提交走正常 staged hooks，`git diff --check` 通过。

目录浏览器 ARIA 预期移至 `apps/web/tests/expected/workspace-management/`；它不进行 Session 日志回放，按当前仓库规则归属 Web 测试。既有 Session seed 保持原位。

## 交接给第 3 步

本轮完成代码修复、本地组合验证和证据整理；Windows 安装包上的中文/空格/不同盘符确认、取消后重试，以及 WSLg/无图形 WSL 实机仍待执行。GUI 测试的两个平台跳过分别是 Windows 原生对话框打开/取消和仅限 Linux 的 WSL Loader 场景；它们不算通过。

此修复支持在 WSL Host 内选择 Linux 目录及 Windows 挂载目录。Windows Host 访问 WSL UNC 路径并不自动获得 Linux 执行环境；跨运行环境支持未在此处实现或认证。两个 WSL 标记都被移除的部署需显式组合 browse，详见[决策记录](../../notes/implemented/bug-fix/2026-09-11-wsl-workspace-directory-selection.md)。

相关现行 Win32 解码、前台窗口和应用打开决策仍有独立职责，未被本次替代；未归档或删除这些记录。没有合并旧 PR、关闭 issue、推送或发布。下一步是 Windows 安装包与 WSL 实机集中验收。
