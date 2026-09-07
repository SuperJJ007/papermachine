# Agent Note：让 Host closure 按打包目标携带自己的 sharp/koffi 原生模块

状态：已实现

[English](2026-09-07-host-native-modules-per-target.md) | 中文

## 问题

有几个 Host 插件在加载期就需要原生模块：`dsh-attachment-local` 在顶层 `import sharp`；`dsh-subprocess-local` 的 `windows-inspector.ts` 与 `dsh-sandbox-windows-acl` 都在顶层 `import koffi`；`fs-local`、`session-persistence-jsonl`、`directory-picker-native` 则动态 import koffi。这几个模块中任何一个在运行时缺失，都会让 Host 进程在打印就绪行之前退出，桌面端会把这个状态显示成"Science Host needs attention"——点 Restart Host 每次都会撞上同一个崩溃，因为打包出来的 closure 在两次尝试之间没有任何变化。

`sharp` 与 `koffi` 都通过 npm 按平台的 `optionalDependencies` 分发原生二进制（`@img/sharp-<os>-<arch>`、`@img/sharp-libvips-<os>-<arch>`、`@koromix/koffi-<os>-<arch>`）。pnpm 默认只会安装运行机器自己那一份变体。`apps/desktop/scripts/stage-host.ts` 用 `pnpm deploy --prod --offline` 从本工作区自己的 `node_modules` 部署 Host closure，所以它产出的 closure 只能带上那一次 `pnpm install` 恰好拉到的变体：

- 在 arm64 mac 上打的 x64 DMG 只带了 `sharp-darwin-arm64`/`koffi-darwin-arm64`。实证：在一个真实打出的 x64 包的 `release/mac/PaperMachine.app/Contents/Resources/host` 目录下跑 `ELECTRON_RUN_AS_NODE=1 arch -x86_64 ../../MacOS/PaperMachine --input-type=module -e "await import('sharp'); await import('koffi')"`——两者都失败（`Could not load the sharp module using the darwin-x64 runtime` / `Cannot find the native Koffi module`）；对 arm64 包跑同样的命令则成功。这意味着已发布的 `papermachine-v0.1.0` 的 `PaperMachine-0.1.0-x64.dmg`（发现问题时已有 5 次下载）在真实的 Intel Mac 上 Host 必崩。
- 在 mac 上交叉打的 Windows 包出于同样的原因，在 win32 应用里带了 mac 自己的 darwin-arm64 变体——这正是一次云机 Windows 实机冒烟撞到的问题（`.agents/tmp/2026-09-06-windows-review/shots/host.log`）。在 `windows-latest` 上原生打的 Windows 包不受影响，因为那台 runner 自己的 `pnpm install` 本来就只会拉 win32-x64 变体。

`pnpm-lock.yaml` 里已经列出了每一个平台变体（`@img/sharp-win32-x64@0.35.3`、`@img/sharp-darwin-x64`、`@img/sharp-libvips-darwin-x64@1.3.2`、`@koromix/koffi-win32-x64@3.1.1`、`@koromix/koffi-darwin-x64@3.1.1` 等等）——lockfile 早就把依赖图可能需要的每个变体都解析好了，所以让安装期真正拉全这些桌面打包目标的变体，不会改变任何依赖解析结果，只会改变某一次 install 调用具体下载哪些可选变体。

## 方案

`pnpm-workspace.yaml` 新增一个 `supportedArchitectures` 块，列出每个桌面打包目标的 os/cpu（`darwin`、`win32`、`linux`；`x64`、`arm64`）以及 `libc: [glibc]`（`linux` 是给 CI 与 Linux 开发机用的，与桌面打包无关；`musl` 不是打包目标，不列入）。这会让每一次 `pnpm install` 都拉全每个桌面目标的 `sharp`/`koffi` 变体，不管是哪台机器在跑安装，代价是会下载单台机器永远用不到的平台变体——而且不只是 sharp/koffi，仓库里其他每个带按平台可选原生模块的包（esbuild、oxlint、rolldown、Claude/Codex 的 agent SDK、workerd 等等）都是同样的模式。`pnpm install --frozen-lockfile` 仍然通过，lockfile 也不受影响，因为 `supportedArchitectures` 只影响某次 install 拉哪些可选变体，不影响依赖解析本身。

`apps/desktop/scripts/native-module-targets.mjs` 是新增的、与具体框架无关的纯模块，装着下面两个打包步骤共用的分类与选择逻辑：`parseNativeModuleEntry` 把一个 `node_modules/@img` 或 `@koromix` 目录名识别成 `sharp-libvips`、`sharp`、`koffi` 三个族之一并解出它的 `(os, arch)`，或者报告成无法识别（比如 `@img/colour`）；`selectNativeModuleTargets(target, entries)` 把一个 scope 的条目拆成 `target` 该保留的与该丢弃的，并且只要某个族在 `entries` 里出现过、却没有恰好匹配 `target` 的条目就抛错，除非一份固定的 `FAMILY_NOT_SHIPPED_FOR_OS` 列表把这个族在 `target` 的 `os` 上豁免掉（目前只有 `sharp-libvips`/`win32` 这一条：`sharp` 的 win32 构建把 `libvips` 打包在自己内部，所以任何版本都不存在单独的 `@img/sharp-libvips-win32-*` 包）。这份豁免列表是固定的既有事实，不是从 `entries` 里恰好出现了哪些 `os` 推断出来的——一版按 `os` 推断的写法先落了地，又被本次改动自己那次 `stage:host` 真跑（针对这台机器真实的、部分损坏的安装状态）当场撞见（见"影响"一节）：从"这个族里有没有任意条目命名了这个 os"去推断"这个族是否为这个 os 出货"，分不清"这个族本来就不为这个 os 出货"与"这个族为这个 os 的每一条都装失败了"这两件事，而一个目标整体缺失，必须和只缺了一部分一样响亮地报错。这个文件是带 JSDoc 类型的纯 JavaScript，不是 TypeScript：electron-builder 的 `afterPack` 钩子直接用 Node 的 ESM 加载器加载它，从不经过 `tsx`，`vitest` 也是直接加载 `.mjs`，所以一份文件同时服务打包钩子与它的单测（`apps/desktop/tests/native-module-targets.spec.ts`），不需要重复实现。一份手写的 `native-module-targets.d.mts` 伴生文件让 `stage-host.ts`（一个 `.ts` 文件）能拿到有类型的 import：TypeScript 的 `bundler` 模块解析只会拿同名的 `.d.mts` 文件去匹配一个 `.mjs` 说明符，从不会用 `.d.ts`——本次改动用一个最小复现验证过这一点（用 `.d.ts` 伴生文件时该 import 隐式 `any` 并报 `TS7016`；改名成 `.d.mts` 后正常解析）。

`stage-host.ts` 在部署并去符号链接完 closure 之后，对每一个 `DESKTOP_PLATFORMS` 条目各调一次 `selectNativeModuleTargets`，扔掉 `keep`/`remove` 的返回值、只依赖它的抛错：只要三个桌面目标里任何一个的 sharp 或 koffi 变体在刚暂存好的 `@img`/`@koromix` scope 里缺失，暂存就会报错失败，并指明修复方式（在 `pnpm-workspace.yaml` 里加上覆盖每个桌面目标的 `supportedArchitectures`，然后重新安装），而不是悄悄产出一个只能在部分目标上启动的 closure。`after-pack.mjs` 里原有的"拷贝 `node_modules`"步骤（本来就必须存在，因为 electron-builder 会从普通的 `extraResources` 拷贝里丢掉 `node_modules`）现在还会调用新增的 `pruneNativeModules`：它从 `electron-builder` 自己导出的 `Arch` 枚举读取 `Arch[context.arch]`（`Arch.x64 === 1`、`Arch.arm64 === 3`——本次改动直接 import 这个枚举验证过，而不是硬编码这两个数值）与 `context.electronPlatformName`（`darwin`/`win32`，正好与这个模块自己的 `os` 命名一致），算出这次具体打包的 `{os, arch}` 目标，然后删掉 `selectNativeModuleTargets` 判给 `remove` 的每一个 `@img`/`@koromix` 目录。这样一来，不管 `electron-builder` 是在哪台机器上、为哪个目标打包，打出来的 app 永远只带每个原生模块族里真正能加载的那一个变体。

`electron-builder.yml` 里 `mac`/`win` 段给 `resources/bin`（来自 2026-09-07 那次 app-local CRT 改动、与 sharp/koffi 无关的 micromamba 二进制）配的 `extraResources` 条目未受本次改动影响——这里只裁剪 Host closure 的 `node_modules`。

## 被否决的替代方案

- **只在各自目标的原生 runner 上打包**（Windows 安装包只在 `windows-latest` 上打，mac 上永不交叉打）。否决：这仍然修不了 Intel mac DMG 那个缺陷（arm64 mac 打 x64 DMG 并不是跨操作系统构建，"每个操作系统只用自己的原生 runner"这条规则对它毫无作用），而且这等于彻底放弃 mac 侧的交叉打包，而不是修掉真正的缺陷。
- **electron-builder 的 `npmRebuild`/`nodeGypRebuild`。** 否决：两者都只作用于 asar 打包之前 app 自己的 `node_modules`，不作用于 `extraResources`——`stage-host.ts`/`after-pack.mjs` 暂存进 `resources/host` 的 Host closure 对这两个选项都不可见。
- **让 sharp/koffi 在运行期变成可选（捕获 import 失败，功能降级）。** 未经调查即否决：这是用户或模型可见的功能减少（附件缩略图、Windows 子进程控制、或 Windows ACL 沙箱会悄悄失效），本仓库的既定规则是任何用户或模型可见的功能减少都必须先取得用户明确同意，不能悄悄以"已知限制"收口。

## 影响

`apps/desktop/tests/native-module-targets.spec.ts` 为 `parseNativeModuleEntry`（每个已知族、一个无法识别的名字、一个族前缀匹配但余下部分不合法的名字）与 `selectNativeModuleTargets`（`darwin-arm64`、`darwin-x64`、`win32-x64` 三个目标各自正确的保留/删除；未知目录名无论目标是什么都保持不动；某个族为目标 `os` 出过货但没有目标 `arch` 时抛错；某个必需的族为目标 `os` 的每一条都缺失时抛错，不只是部分缺失——这正是按 `os` 推断的豁免版本最初漏掉的情形；某个族在目标 `os` 上被豁免时不抛错——即便该族在同一份列表里为另一个 `os` 出过货——覆盖 win32 缺失 `sharp-libvips` 的情形）写了单测。

按 `os` 推断的豁免写法不是靠代码评审、而是靠真跑本次改动新加的这个断言撞见的：对这台机器真实的安装跑 `pnpm --filter @deepseek-ai/dsh-desktop run stage:host`——darwin 的每个 sharp/koffi 变体都在，`@img/sharp-win32-x64@0.35.3` 确实缺失（本机网络下不到，见本任务书自己的结果段）——结果退出码是 0 而不是报错失败，因为 `@img` 的目录列表里压根没有任何一条 `os` 是 `win32` 的条目，按 `os` 推断的检查把这读成了"sharp 不为 win32 出货"，而不是"sharp 的 win32 条目缺失了"。修完重跑：同一条命令现在退出码是 1，报错 `desktop host staging: @img is missing the win32-x64 native module variant a packaged Host for that target needs (no sharp-win32-x64 entry for the win32-x64 packaging target (no sharp entry for win32 at all))`。

具体跑过的验证命令、输出、以及打出的安装包 SHA-256/大小，见本任务书自己的结果段。
