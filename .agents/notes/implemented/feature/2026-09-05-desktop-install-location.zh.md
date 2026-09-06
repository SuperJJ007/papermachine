# Agent Note: A chosen Harness home persists as a pointer file, applied by relaunch

Status: implemented

[English](2026-09-05-desktop-install-location.md) | 中文

## Problem

`resolveHarnessHome`（`harness-home.ts`）早就接受一个 `customHomeDir` 参数，其优先级高于 `PAPERMACHINE_HOME` 与 `DSH_HOME`，但应用内从未有任何地方真正传入过它：Windows 上 `C:` 盘装不下约 6 GB 的随应用发布 environment 的用户，除了在启动一个打包 GUI 应用之前先设置环境变量之外，没有别的办法把它装到别处——而这根本不是打包安装包的用户能走的流程。另外，onboarding 安装失败路径上的 "Copy Diagnostic Report" 按钮已经给出了 platform、user agent、时间与错误文本，却缺少 Harness home 路径和到底尝试过哪个 package source——这恰恰是维护者分诊一份报错时最先需要的信息，也是一份已提交 issue 点名要求的两处缺口。

## Decision

新增模块 `install-location.ts`，直接在 OS home directory 下拥有一个 pointer 文件 `<osHomeDir>/.papermachine-home`——刻意选用纯 ASCII 文件名，使其在 home directory 自身路径本就有问题时（含非 ASCII 字符、含空格）依然可读。该文件只保存一行绝对路径，通过与 environment-binding、applied-environment 两个 pointer 共用的既有 `writeFileAtomic`（`atomic-write.ts`）原子写入。`readInstallLocationPointer` 在文件缺失（普通情形）时返回 `undefined`；文件存在但为空、只含空白，或指向相对路径时则抛错并点名该文件——若对一个损坏的 pointer 悄悄回退到默认 Harness home，会让 Host 与每一个 kernel 都在错误的盘上运行，且没有任何提示原因。`main.ts` 的 `harnessHome()` 读取这个 pointer 并将其作为 `resolveHarnessHome` 的 `customHomeDir` 传入，因此 pointer 文件现在的优先级高于 `PAPERMACHINE_HOME` 与 `DSH_HOME` 二者——它是 GUI 用户无需设置环境变量即可触达的那一档优先级，`harness-home.ts` 的 JSDoc 记录了本应用对该参数的具体来源。

Onboarding 的环境选择界面有一行安装位置，由 `desktop:install-location` IPC 调用渲染，显示已解析的路径，配一个 "更改…" 按钮，以及——仅在有 pointer 文件生效时——一个 "恢复默认" 按钮。这一行的说明文字如实写明：更改位置会重启应用，并像全新安装一样重新开始——会话、环境绑定，以及此前位置下已安装的 environment 都留在原地，什么都不会被移动，所以新位置需要重新安装 environment。"更改…" 从 main process 打开 `dialog.showOpenDialog`（绝不用本应用 renderer 禁止的 `window.prompt`），默认路径取当前 Harness home 的父目录；对话框被取消会报告 `cancelled`，不改动任何东西。所选目录（`main.ts` 的 `resolveChosenInstallLocationPath` 从中计算出实际目标，目前原样返回）会先调用 `resolveHarnessHome` 本身完成校验，再谈写入——一个会触发 `HarnessHomeSpaceError` 的候选路径会被报告为 `rejected`，但 reason 会围绕 "所选文件夹" 重新措辞，而不是照搬该错误自身的文案（它写的是 "你的用户主目录"，对默认位置失败的场景是对的，对用户刚选中的文件夹却是错的）。路径中含有非 ASCII 字符时（按已提交 issue 所说，这是部分 conda 与 R 包的一个未证实风险）会触发一个双语的 `dialog.showMessageBox` 警告，用户可以接受或拒绝；拒绝与直接关掉选择器一样都报告 `cancelled`。接受后先写入 pointer 文件，再调用 `app.relaunch()`，紧接着调用 `app.quit()`——`relaunch()` 只是预约重启，真正发起关闭的是 `quit()`，因此既有的 `before-quit` handler 仍会先跑一遍 `coordinator.beforeQuit()`（中止任何 provisioning、停止 Host、flush telemetry），进程才退出，Electron 再用新 home 干净地重新启动它。"恢复默认" 会清除 pointer 文件并按同样方式重启。两个 handler 都报告 `restarting`，renderer 收到后会禁用这两个按钮并显示一条正在重启的提示，而不是试图回到一个即将被拆掉的 ready 状态；一次改为直接抛出的 IPC 调用（不同于报告出 `rejected` 结果）会被两个点击处理器各自捕获，展示错误并重新启用控件，与这一行自身的 `installLocation()` 加载路径对称。

安装正在进行时点击 "更改…" 或 "恢复默认" 会被直接拒绝，而不是在下载中途重新启动：重启会中止这次 provisioning 并悄悄丢弃已下载的字节，没有任何确认，所以 `onboarding.ts` 里那个早就负责在一次 provisioning 运行期间禁用每一个会开始新工作的控件的 `setBusy`，现在也一并禁用这两个按钮；`main.ts` 的 choose/reset handler 也独立地在模块级 `provisioning` 这个 `AbortController`被设置时拒绝并给出理由，这样即便某次点击在 renderer 自己的禁用生效之前就已经到达 handler，拒绝依然成立。

一个值本身是合法绝对路径、但其目标在启动时无法到达的 pointer——外接盘被拔掉、网络共享被卸载、权限被更改——会得到自己专门的恢复页面，而不是走通用的 Host 错误页。`boot()` 会在注册任何其他东西之前先自行解析 Harness home，因此这是本应用所有代码里能撞上的第一类启动失败；`isInstallLocationUnavailable`（`install-location.ts`）是决定一次 `resolveHarnessHome` 失败是否符合条件的纯判定函数（有 pointer 生效，且失败不是已经单独处理过的 `HarnessHomeSpaceError`），`installLocationUnavailableErrorPage`（`error-page.ts`）负责渲染这个页面，点名 pointer 文件与不可达的目标，并提供 "使用默认位置"（清除 pointer 并重启，复用 `error-page.ts` 里 `RESTART_URL` 早就在用的同一套 main-world navigation 守卫）与 "退出" 两个动作，取代只会重试同一个坏掉的 pointer 的常规 Restart Host。

诊断报告有一个 `desktop:diagnostics` IPC 调用，返回应用版本、`${platform}-${arch}`、已解析的 Harness home，以及它是否被自定义过。onboarding 会跨 `onProvisioningProgress` 的多次更新持续追踪最近一次尝试过的 package source（从已确认的选择开始播种，与 `main.ts` 自身早已为 telemetry 做的 `lastSourceId` 追踪同一套规则），并在安装失败时先取一次 diagnostics 再构建报告，从而能加上应用版本、一行更精确的 platform（`darwin-arm64`，而不是浏览器笼统的 `navigator.platform`）、带自定义/默认标注的 Harness home 路径，以及最近尝试过的 source——与既有的 user agent、时间及围栏包裹的错误文本并列。

## Alternatives considered

- **把这个选择存到 Electron 的 `userData` 下。** 直接否决：`apps/desktop/tests/no-userdata-regression.spec.ts` 禁止 `src/` 下出现任何 `getPath('userData')` 调用，而且 `userData` 自身在 macOS 上的路径含有空格，正是 `harness-home.ts` 早就在绕开的那个缺陷——把指向一个无空格 Harness home 的 pointer 存进一个含空格的目录，等于让这个 pointer 自己的位置成为同一类 bug 的下一个实例。
- **要求用环境变量（`PAPERMACHINE_HOME`）而不是 GUI 控件。** 这正是已提交 issue 点名指出不可用的现状：一个打包 GUI 应用的用户没有寻常办法在启动前设置一个进程环境变量；两个既有环境变量仍然为那些确实用得上它们的工作流保留。
- **不重启，实时重新解析 Harness home，热切换正在运行的 Host。** 否决：Host、每一个 kernel 子进程、watchdog，以及 `activeOrigin`、`hostLogPath` 这类内存状态，都在创建时就与那一刻的 home directory 绑定；为了一次罕见的、用户主动发起的操作而把这些全部拆掉再原地重建，等于把 `boot()` 自身启动序列的大半重复一遍，而重启复用的正是每一次普通启动都会走、已经验证正确的那条代码路径。
- **跳过非 ASCII 警告，直接接受路径。** 否决：已提交的 issue 点名非 ASCII 路径是部分 conda 与 R 包在中文用户名下失败的一个真实、但未证实的原因；只警告不拒绝，把选择权留给用户，同时把这个风险提前摆出来，而不是让用户在一次耗时数分钟的安装失败之后才发现它。
- **在所选目录之上追加一个固定的子目录名，再作为 Harness home。** 延后，而非否决：不在选择器里进一步导航就直接确认，会把它的 `defaultPath`——当前 Harness home 的父目录，默认情况下就是 `~`——原样当作新的 Harness home，让 `environments/`、`micromamba/` 与每一份 session 文件直接散落进去。修复这一点需要产品先拍板子目录该叫什么名字，以及写入之前是否要把最终路径展示给用户确认；`resolveChosenInstallLocationPath`（`main.ts`）的存在就是为了让这个决定一旦落地，只需要改这一个函数。

## Consequences

系统盘较小的用户现在可以直接在 onboarding 里把约 6 GB 的整个 environment 重定向到另一块盘，不需要环境变量，也不需要命令行。这个 pointer 文件是一种新的磁盘格式，在这个 pre-release 代码库里不作任何兼容性承诺；未来的格式变更可以按本仓库的 pre-release 立场直接替换它。每一次安装位置变更都要付出一次完整的应用重启（几秒钟），这个代价是可接受的，因为它复用了与普通启动相同的启动路径，而不是另一条较少被验证过的原地拆装路径。一份安装失败的诊断报告现在会点名具体的 Harness home 与所涉及的 package source，而此前一份已提交的 issue 只能靠错误文本本身去猜测这些信息。按上面延后的那一条，如果用户在目录选择器自身的默认位置上直接确认——最直接的情形就是 `~` 本身——那个目录就会原样成为 Harness home、不会追加任何内容；在这一点落地之前，明确选中一个子目录是唯一的规避办法。

## Verification

`apps/desktop/tests/install-location.spec.ts` 覆盖了 pointer 文件路径、`readInstallLocationPointer` 在文件缺失时返回 `undefined`、在内容为空、只含空白、或为相对路径时抛错并点名该文件、写入再读回的往返、原子替换不留下临时文件、`clearInstallLocationPointer` 删除既有文件且对缺失文件是 no-op、`hasNonAsciiCharacters` 对 ASCII 路径、CJK 路径与仅含空格路径（false——这是一个不同的、被单独检查的风险）的判断，以及 `isInstallLocationUnavailable` 对"有 pointer 且目标不存在"、"有 pointer 且目标不可写"、"没有 pointer"与"含空格路径"（false——`HarnessHomeSpaceError` 有自己的页面）四种情形的判断。`apps/desktop/tests/error-page.spec.ts` 覆盖了 `installLocationUnavailableErrorPage` 点名 pointer 文件、目标与原因，并提供 "使用默认位置"/"退出" 而非 Restart Host。`apps/desktop/tests/onboarding.spec.ts` 覆盖了安装位置这一行渲染出已解析路径、"恢复默认" 仅在自定义时出现、`rejected` 结果（含安装进行中这一理由）展示原因并重新启用控件、`restarting` 结果禁用两个按钮、两个按钮在一次 provisioning 运行期间保持禁用且在失败后重新启用、任一按钮的 IPC 调用被拒绝时都能以同样方式恢复，以及诊断报告字符串中含有应用版本、Harness home 与最近尝试过的 source。`apps/desktop/tests/harness-home.spec.ts` 与 `apps/desktop/tests/no-userdata-regression.spec.ts` 保持不变、全绿。`main.ts` 里的 IPC 接线与 `dialog` 调用仅限 Electron 环境、无测试覆盖，符合本包既有的测试边界；`isInstallLocationUnavailable` 的存在就是为了让 `boot()` 恢复分支背后的判定逻辑不依赖这条边界。`resolveChosenInstallLocationPath` 目前尚无测试——它在上面延后的那个方案落地之前只是一个恒等函数——但点出了未来改动唯一需要改的那个调用点。
