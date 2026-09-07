# Agent Note：给打包出的 mac app 做 ad-hoc deep 签名，让 Gatekeeper 判定为身份不明的开发者而不是已损坏

状态：已实现

[English](2026-09-07-mac-adhoc-deep-signature.md) | 中文

## 问题

issue #23（Livwv，Mac Studio）：打开 0.1.0 arm64 DMG 里的 app，macOS 提示`"PaperMachine.app" 已损坏，无法打开。你应该将它移到废纸篓`。README 里已有的建议（"右键点击应用，选择打开"）对这个提示完全无效：那条修法只对 Gatekeeper 另一种"身份不明的开发者"判定有效，而这台设备撞上的是"已损坏"。

根因已在本仓库自己打出的产物上实证：无论本机还是 CI，`electron-builder` 的构建日志都记着 `skipped macOS application code signing`（本仓库任何地方都没有配置 Apple Developer ID 身份），所以打包出的 `PaperMachine.app` 只带着 Electron 自己链接步骤已经给其二进制打上的 ad-hoc 签名——这份签名只覆盖 Electron 自己的代码,不覆盖这个应用的 bundle 资源。对这份包跑 `codesign --verify --deep --strict PaperMachine.app` 会报 `code has no resources but signature indicates they must be present`。Gatekeeper 把这个具体状况原样呈现给用户,就是"已损坏,无法打开"——界面上和一次真的下载损坏没有区别;用户唯一能用的修法是 `xattr -dr com.apple.quarantine`,右键 → 打开对它无效。

针对同一个 app 的本地实验证实了修法:跑一次 `codesign --force --deep --sign - PaperMachine.app`(覆盖每一份资源与每一个嵌套可执行文件的 ad-hoc 签名)之后,原本失败的 `codesign --verify --deep --strict` 变成通过,`spctl --assess --type execute` 的判定也从"已损坏"那种状况变成普通的 `rejected`——Gatekeeper 正常的身份不明开发者判定。macOS 15 起,Apple 自己的发行说明(《Updates to runtime protection in macOS Sequoia》,developer.apple.com/news/?id=saqachfa)写明:对未正确签名或未公证的软件,Control-click → 打开不再能覆盖 Gatekeeper——ad-hoc 签名的包两条都占,所以用户改为经 系统设置 → 隐私与安全性 放行。右键 → 打开只在 macOS 15 之前的版本上仍然有效。

真正的根治是拿到 Apple Developer ID 证书并做公证,这是用户自己尚未做出的商业决定,不在本次改动范围内。本次改动是 ad-hoc 签名这个缓解方案,加上对应的 README 修法,两者都限定在 0.1.1。

## 方案

`apps/desktop/scripts/sign-mac-app.mjs` 是一个新的、不依赖框架的模块,导出 `signMacApp(appPath, execFile)` 与 `maybeSignMacApp(electronPlatformName, appPath, execFile)`。`signMacApp` 依次跑 `codesign --force --deep --sign - <appPath>` 再跑 `codesign --verify --deep --strict --verbose=2 <appPath>`,两次调用都经过一个注入的、`execFile` 形状的函数(默认是 promisify 过的 `child_process.execFile`),把两次调用的 stdout/stderr 都转发进调用方的构建日志,任意一次调用非零退出就抛错——错误里指明是哪一步失败,并带上那次调用的 stderr。`maybeSignMacApp` 是平台闸门:对 `darwin` 之外的任何 `electronPlatformName` 都什么都不做,所以 win32 或 linux 的 `afterPack` 运行永远不会去调用 `codesign`。`apps/desktop/scripts/after-pack.mjs` 的 `afterPack` 钩子把 `maybeSignMacApp` 放在最后一步调用,在 `pruneNativeModules`、`pruneForeignPlatformVariants`、`assertBundledRuntimePresent` 都编辑或读取完 bundle 之后。electron-builder 真实的钩子顺序(app-builder-lib 26.15.3 的 `platformPackager.js`)是 `afterPack`(这份签名)→ `sanityCheckPackage`(只读)→ `@electron/fuses` 按配置翻转 fuse 位,会改写 `Contents/Frameworks/Electron Framework.framework/…/Electron Framework` → electron-builder 自己的代码签名步骤(这里因 `mac.identity: null` 被跳过)→ `afterSign` → DMG 组装——即 fuse 翻转跑在这份签名**之后**而不是之前,任何一次把某个 fuse 从 Electron 默认值改掉的构建都可能让这份签名失效。`apps/desktop/electron-builder.yml` 的 `electronFuses.resetAdHocDarwinSignature: true` 补上了这个缺口:`@electron/fuses` 会在翻转之后立刻对 `.app` 重新签名(ad-hoc,不带自己的 verify),所以最终随包出货的签名来自这一次后置重签,本模块的 verify 仍然是这条链路里唯一的断言。

`--deep` 是必需的,不是可选项:打包出的 app 里带着嵌套的可执行文件(`Contents/Resources/host` 下的 Host、随包本地的 micromamba 可执行文件),浅层签名覆盖不到它们,任何一个没签名都会让 `codesign --verify --deep --strict` 失败。`--sign -`(ad-hoc)是没有 Apple Developer ID 时唯一可用的选项。

`apps/desktop/electron-builder.yml` 加上了 `mac.identity: null`,这样 electron-builder 自己的签名步骤会因为显式配置而无条件跳过,而不是每次构建都去探测钥匙串、发现没有身份。这也意味着,一台构建机的钥匙串里万一意外存在一个真实身份(本仓库不跑公证),也不会被误用去产出一个"已签名但未公证"的包——那是另一种独立的 Gatekeeper 拒绝判定,并不比今天的 ad-hoc 判定更好。

根目录 `README.md`/`README.zh.md` 与 `apps/desktop/README.md`/`README.zh.md` 的安装包段落现在把两种 Gatekeeper 提示与各自的修法拆开说:"身份不明的开发者"是 0.1.1 起正常应该遇到的提示,经 系统设置 → 隐私与安全性 → 仍要打开 放行(macOS 15 之前的版本也可以右键 → 打开);"已损坏,无法打开"(只能 `xattr -dr com.apple.quarantine`,因为 app 本身是目录所以要 `-r`)作为用户仍可能遇到的兜底情况列出。同一次编辑把 Windows 安装包标为实验性 / Beta,列出其已知限制(沙箱只做 `partial` 强制、R 在非 ASCII 路径/用户名下有边角情况、最低需要 Windows 10 64 位、提 issue 时附上 `%USERPROFILE%\.papermachine\logs`)——这是与本次签名修复同一天但相互独立拍板的决定。

## 被否决的替代方案

- **拿到真实的 Apple Developer ID 证书并做公证。** 这才是真正的根治,能彻底去掉 Gatekeeper 提示。本次改动里否决:这需要加入 Apple Developer Program,是用户自己尚未做出的商业决定;没有它,ad-hoc 签名是唯一可用的缓解手段。
- **只改 README(为"已损坏"提示记录 `xattr -dr`,不改签名)。** 否决:这会让每个用户每次安装都要手敲一遍终端命令,而 ad-hoc 签名能直接消掉"已损坏"这个判定,把剩下的提示降级成 Gatekeeper 正常的身份不明开发者拒绝——多花一次 `afterPack` 里的 `codesign` 调用,换来明显更好的用户体验。
- **把签名放进 `package:mac`/`package:win` 自己的脚本链而不是 `afterPack`。** 否决:`afterPack` 是原生模块裁剪完成之后 electron-builder 提供的最早钩子,而 app-builder-lib 自己的 `configuration.d.ts`(`AfterPackContext`,第 393 行)逐字记的是"after pack but before pack into distributable format and sign"——即跑在 electron-builder 自己的签名步骤与随后的 `@electron/fuses` 翻转之前,不是之后。把签名放得比 `afterPack` 更晚没有更早的钩子可选;本次改动真正要处理的时序风险是跑在 `afterPack` 之后的 fuse 翻转,已经用 `electronFuses.resetAdHocDarwinSignature` 处理,而不是靠把签名挪到更晚的钩子。

## 结果

`apps/desktop/tests/sign-mac-app.spec.ts` 对 `signMacApp`(sign 先于 verify 运行,两次都对给定的 `appPath`,命令都是 `codesign`;sign 失败就抛错并带上其 stderr,且不会再去跑 verify;verify 失败也抛错并带上其 stderr)与 `maybeSignMacApp`(`darwin` 会签名;`win32` 或 `linux` 时 `execFile` 被调用零次)做了单元测试,全部针对注入的 mock `execFile`,没有真的调用 `codesign`。`apps/desktop/tests`(30 个文件,全部通过)与 `pnpm exec tsc -b tsconfig.host.json` 在本次改动上都跑过且干净。

本次改动跑过的决定性打包验证,不只停在上面的单测:

- **mac arm64(`--dir`):** `electron-builder` 自己的日志记下了 `skipped macOS code signing reason=identity explicitly is set to null`,证实新加的 `mac.identity: null` 生效了,紧接着就是本次改动自己的 `afterPack` 签名步骤的 `codesign --force --deep --sign -`/`--verify --deep --strict` 输出,以 `PaperMachine.app: valid on disk` / `satisfies its Designated Requirement` 收尾。单独对打包出的 app 再跑一次 `codesign --verify --deep --strict --verbose=2` 退出码为 0。`codesign -dv --verbose=2` 报告 `Signature=adhoc`、`TeamIdentifier=not set`。`spctl --assess --type execute --verbose=2` 报告 `rejected`(退出码 3)——Gatekeeper 正常的身份不明开发者判定,不是已损坏那种。在打包出的 app 内以 `ELECTRON_RUN_AS_NODE=1` 导入 `sharp` 与 `koffi` 都报告 `OK`;一个真实的 Host 进程(`lib/bin.js --profile web --patch … --port 0`)几秒内打印出 `dsh web: http://127.0.0.1:55048`,验证完毕后只 `kill` 了它自己记下的 PID。
- **mac x64(`--dir`,`arch -x86_64`):** 对 `release/mac/PaperMachine.app` 跑同样的检查:`codesign --verify --deep --strict` 退出码 0,`Signature=adhoc`,`spctl --assess` 报告 `rejected`(退出码 3)。`sharp`/`koffi` 在 `arch -x86_64` 下都是 `OK`;Host 打印出 `dsh web: http://127.0.0.1:55261`,同样只 `kill` 了它自己的 PID 后停止。
- **隔离属性模拟:** 给 arm64 `.app` 的一份副本打上 `com.apple.quarantine`(`0083;00000000;Safari;`),`spctl --assess` 报告 `rejected`;打开这份副本时,统一日志里 `syspolicyd` 记下了 `GK evaluateScanResult: 0, PST: (path: …), (team: (null)), (id: com.papermachine.desktop), (bundle_id: com.papermachine.desktop), …`,紧接着是 `Prompt shown (6, 0), waiting for response`——这是正常的身份不明开发者流程走到了它的交互式提示这一步,不是已损坏判定那种直接拒绝。这份带隔离属性的副本对应的进程只 `kill` 了它自己记下的 PID 后停止;副本之后已删除。
- **DMG:** `pnpm exec electron-builder --mac dmg --arm64` 产出了 `release/PaperMachine-0.1.0-arm64.dmg`,177,487,957 字节,SHA-256 为 `e7083564f73075e4d3e843b118675de22ce68326710de26f481cc95c9db483ca`。用 `hdiutil attach` 挂载后,对挂载出的 `PaperMachine.app` 跑 `codesign --verify --deep --strict` 退出码为 0(`valid on disk`、`satisfies its Designated Requirement`);之后 `hdiutil detach` 干净卸载。
- **本次改动之后复验 `resetAdHocDarwinSignature`**(arm64 `--dir`,同上一次 electron-builder 调用):`codesign --verify --deep --strict --verbose=2 release/mac-arm64/PaperMachine.app` 退出码 0(`valid on disk`、`satisfies its Designated Requirement`);`codesign -dv --verbose=2` 报告 `Signature=adhoc`、`TeamIdentifier=not set`。对 fuse 翻转与 afterPack 签名都会碰的两个文件跑 `stat -f '%m %N'`:`Contents/_CodeSignature/CodeResources` 的 mtime `1788786055`(21:00:55)不早于 `Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework` 的 mtime `1788786053`(21:00:53)——资源封印的时间晚于框架被改写的时间,证实打包出的 app 最终携带的签名来自 `@electron/fuses` 翻转之后那一次,而不是本模块在翻转之前打上的那一次。构建日志里的 `executing @electron/fuses`、`skipped macOS code signing reason=identity explicitly is set to null` 两行按预期夹住了翻转这一步;`@electron/fuses` 不会把它自己 `resetAdHocDarwinSignature` 触发的那次 `codesign` 调用单独记成一行日志,所以这一效果是靠上面的 mtime 对比与外层的 verify/dv 输出确认的,不是靠一行独立日志。

本次改动**没有做、或未验证**的事:没有配置 Apple Developer ID 或公证,所以首次启动仍然会弹出一次 Gatekeeper 提示(身份不明的开发者),而不是完全没有提示。Windows 安装包自身的签名状态没有变化——一如既往地未签名,文档也照旧说明。身份不明开发者提示本身的文字从未被捕获:上面的隔离属性模拟只观测到了 `syspolicyd` 统一日志里"提示已弹出"这一条记录,不是弹窗的措辞本身,所以 README 里三条路径的写法依据的是 Apple 自己对这套机制的文档说明(上文已引用),而不是一份屏幕文字实录。
