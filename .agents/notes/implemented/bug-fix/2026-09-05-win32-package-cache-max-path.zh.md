# Agent Note: Windows 上的 micromamba package cache 保持在 MAX_PATH 之内

Status: implemented

[English](2026-09-05-win32-package-cache-max-path.md) | 中文

## Problem

随应用发布的 `general` environment 在 Windows 11（`LongPathsEnabled=0`）上首次安装时，在 `qt6-main` 处失败：`libmamba Error when extracting package: remove_all: The directory is not empty`（报告见 [issue #4](https://github.com/SuperJJ007/papermachine/issues/4)）。micromamba 2.x 按来源 host 与 channel 分层排布 package cache——`<MAMBA_ROOT_PREFIX>/pkgs/https/<mirror host>/<channel path>/win-64/<package>/...`——而本应用默认的 cache root，`<dshHome>/desktop-environments/micromamba/pkgs`（位于 per-user 的 `C:\Users\<user>\.papermachine\...` 之下），使得最长的这类相对路径依镜像不同分别达到 285、301 或 310 个字符，均超出 Win32 260 字符的 `MAX_PATH`。报告者证明了：当改用 `CONDA_PKGS_DIRS=C:\pm` 时，完全相同的 `micromamba create` 会成功（312 个 package，所有 health check 通过）。随应用发布的 micromamba 2.9.0 没有任何选项能压平这种分层 cache 布局。

同一报告中还包含第二个独立的缺陷：`DesktopEnvironmentProvisioner` 的 health-check 步骤无条件地拼接 `prefix`、`'bin'` 与 `check.executable`。在 win32-x64 上，interpreter 实际位于 `<prefix>\python.exe` 与 `<prefix>\Scripts\Rscript.exe`，而不是 `<prefix>\bin\python`，因此即便 `create` 成功，verifying 阶段也会失败。

## Decision

`resolvePackageCacheDir`（`apps/desktop/src/provisioning.ts`）把 package cache 目录解析为 `{ platform, root, systemDrive }` 的纯函数，`DesktopEnvironmentProvisioner.provision` 把它的结果作为 `CONDA_PKGS_DIRS`，与既有的 `MAMBA_ROOT_PREFIX` 一并传入每一次 `create` 尝试的环境变量。在 darwin 上它返回 `<root>/micromamba/pkgs`——与 micromamba 原本会隐式推导出的路径相同，因此 darwin 上的行为不变。在 win32-x64 上它返回 `<SystemDrive>\pm\pkgs`，用 `node:path` 的 `win32` 子模块构建，因此结果的确定性与运行该函数的宿主 OS 无关（测试在 macOS 上验证它）。`systemDrive` 取自 `process.env.SystemDrive`，仅当该变量缺失时才回退到 `C:`（Windows 默认会设置它；变量缺失是唯一没有更好真值来源的情形）。解析出的 win32 cache root 只有 10 个字符，让约 245 字符长的、已知最长的分层相对路径安全地留在 `MAX_PATH` 之下。这个目录会在第一次 `create` 尝试之前用 `mkdir(..., { recursive: true })` 创建；创建失败会抛出一个点名该路径的错误，因此 onboarding 会原样展示它，而不是悄悄回退到那个过长的默认路径。

在 Windows 上，这个 cache 目录位于 `<dshHome>` 之外。本应用同样不会删除 `<dshHome>/desktop-environments/micromamba`——没有任何 uninstaller 或 reset 路径会枚举或删除 provisioner root 下的内容，重新配备时也只清空单个 environment 的 prefix——因此这不是清理行为上的回退，只是一个值得记录的事实：本应用今天没有任何机制会回收 Windows 上的这个 package cache。`environment-binding.ts` 的 `isWithinProvisionedRoot` 不受影响——它只校验被绑定的 environment prefix（`<dshHome>/desktop-environments/environments/...`），在任何平台上都从不涉及 package cache。

health-check 步骤现在通过 `interpreterLayout(isWindows)` 解析每个 check 的可执行文件，该函数从 `apps/desktop/src/interpreter-presence.ts` 导出（此前是一个由 `process.platform` 构建、模块内私有的 `INTERPRETER_LAYOUT`），按 `check.language`（`'python' | 'r'`）取值，而不是按 `check.executable`。`DesktopEnvironmentProvisioner` 用 `this.options.platform.startsWith('win32-')` 调用它，而不是 `process.platform`，因此测试可以在 macOS 上验证 win32 布局。`qualifyingInterpreters`（`interpreter-presence.ts`）仍然基于 `process.platform` 构建自己的这张表，因为它运行在 `main.ts` 中，紧跟在同一台真实主机上刚完成的一次真实 provisioning 之后。这两个调用点现在读取同一个导出函数，而不是各自维护同一张表的独立副本，因此 provisioning 的 health check 与 `qualifyingInterpreters` 的 post-bind 复核不会再为同一个 prefix 给出不同的路径。`EnvironmentHealthCheck.executable` 仍是一个经过校验的 declaration 字段，但不再参与路径构建；它保留作为一个 check 所验证的是哪个 interpreter 的声明性名称。

## Alternatives considered

- **在安装期间通过 Windows 注册表设置 `LongPathsEnabled`。** 已否决：这需要提权，而这个 per-user、不需要提权的安装包没有提权能力，并且这会依赖本应用无权也不应改动的机器级策略，只为了一个 package cache 目录。
- **在 cache 目录上使用 `\\?\` 长路径前缀。** 已否决：报告者自己的证据是——仅仅换成一个短的 `CONDA_PKGS_DIRS`、不改动任何其他东西，完全相同的 `create` 就会成功；而 `\\?\` 前缀并不被 micromamba/conda 工具链自身路径处理中的每一个工具普遍支持，因此这是一个验证程度不如已在真实硬件上得到证实的方案。
- **用 `subst`/junction 把一个短盘符映射到那个长的 `<dshHome>` 路径。** 已否决：这会为一个报告者的证据已经用一个环境变量就能解决的问题，额外引入第二份需要创建、校验与清理的机器全局状态。
- **随应用发布一个 cache 布局更扁平的更新版 micromamba。** 对本次修复而言已否决：随应用发布的 2.9.0 目前没有这类选项（已核对 `create --help` 与 `config list`），而锁定到一个尚未发布或未经验证的更新版本，是一项更大、独立的改动，有它自己的风险。

## Consequences

Windows 上的 package cache root 被固定为 `<SystemDrive>\pm\pkgs`，而不是像本应用其余每一份状态那样落在 `<dshHome>` 之下。目前在任一平台上都没有任何东西会清理它，这与既有行为一致，而不是一个新出现的缺口。`resolvePackageCacheDir` 与 win32 health-check 布局由 `apps/desktop/tests/provisioning.spec.ts` 中的单元测试覆盖（两个平台的纯函数解析与 `SystemDrive` 回退、解析结果抵达 `CONDA_PKGS_DIRS`、目录无法创建时的 loud 失败，以及 win32 health-check 可执行文件路径），使用一个 fake `ProcessRunner`，全部可在 macOS 上运行并通过。Windows 平台本身的行为——在新的 `CONDA_PKGS_DIRS` 下真实的 `micromamba create` 能否成功，以及 health check 能否针对真实的 win32 布局通过——自本次改动以来尚未在真实 Windows 硬件上重新验证；报告者最初的证据只单独覆盖了 `CONDA_PKGS_DIRS` 这个机制本身，并不覆盖这次改动的确切代码路径。
