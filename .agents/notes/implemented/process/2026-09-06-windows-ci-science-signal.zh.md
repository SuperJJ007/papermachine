# Agent Note：让 Windows CI 对 Science 给出真信号

Status: implemented

[English](2026-09-06-windows-ci-science-signal.md) | 中文

## 问题

[ci.yml](../../../../.github/workflows/ci.yml) 里的 `windows-native` job 对 Science 完全没有价值。runner 上没有 Python 也没有 R，`kernel-transport-real.spec.ts` 每次都两条自跳过。`science-runtime`、`tool-science`、`sandbox-windows-acl` 里还带着大量 POSIX-only 的测试夹具——`#!/bin/sh` 假解释器、`chmodSync(…, 0o000)` 权限模拟、写死的 `/usr/bin/env`——在 win32 上成片失败,原因和它们要验证的产品代码毫无关系,把真正的 Windows 专属缺陷埋进了夹具噪声里。一个 PR 完全可能在 Windows 上弄坏 Science,而 CI 不会给出任何信号。

## 决定

**测试侧**(`packages/science/science-runtime`、`packages/science/tool-science`、`packages/sandbox/sandbox-windows-acl`):每处 POSIX-only 夹具都用 `it.skipIf(process.platform === 'win32')` 或 `describe.skipIf(...)` 在 win32 上跳过,每处都带一句原因。没有把任何夹具移植到 Windows,也没有放宽任何断言——完整清单见下面的[跳过清单](#skip-inventory)。

`kernel-transport-real.spec.ts` 新增 `DSH_SCIENCE_REAL_PREFIX`,其检查顺序排在桌面应用自己的 `~/.papermachine/environment-binding.json` 之前、裸 PATH 查找之前,这样 CI 能直接指定一个已配置好的 Conda 前缀,而不用去猜。它特意选了一个和 `chart-kernels.real.spec.ts` 的 `DSH_SCIENCE_RUNTIME_PYTHON_PREFIX`/`_R_PREFIX` 这对不同的名字:那一对同时也会触发真实的 matplotlib/ggplot2 图表驱动测试,而 CI 环境里只装了裸的 `python=3.13 r-base=4.5`,满足不了那些依赖。本机不设这个变量时,自跳过行为不变。

实机验证跑出了 4 处本机(macOS)从未见过的失败,都是真实存在的跨平台缺陷,按缺陷修复而非跳过处理:
- `reconcile-trigger.spec.ts` 写死了一个绝对 POSIX `cwd` 字面量,在 win32 上永远匹配不上生产代码 `resolve(header.cwd)` 的比较——`resolve()` 对一个已经是绝对路径的输入并非空操作。修法是把夹具的字面量也套一层同样的 `resolve()`。
- `kernel-process.spec.ts` 的 `NUMBER_OF_PROCESSORS` 环境变量断言:在真实云机上用 `node -e` 直接探测确认,`process.env.NUMBER_OF_PROCESSORS = '8'` 在那里根本不生效——Node/libuv 对这一个 key 每次读取时都会取实时的操作系统处理器数,而不是进程自己的环境块。把这一个 key 的精确值断言收窄成存在性断言,同一循环里其余每个环境变量仍保留精确值断言。
- `artifact-file.spec.ts` 的硬上限遍历测试在这次改动让套件里更多用例在 win32 上真正执行起来之后,在并发下踩了两次坑:先是测试体自己的 30 秒超时(单独跑 14 秒,并发下实测超过 30 秒;翻倍到 60 秒),然后是它文件级的 `afterEach` 清理钩子——要删掉那条测试留下的一万多个文件——而 vitest 用一个独立的默认 `hookTimeout` 来限制这个钩子,测试自身的超时覆盖管不到它。现在这个钩子也补了自己的 60 秒超时;断言本身都没改。
- `prefix-manifest.spec.ts` 写死了一个 POSIX 分隔符的符号链接目标字面量(`'../outside'`)。`capturePrefixManifest` 按设计保留 `readlink` 返回的原始未解析字符串,而 win32 的 `CreateSymbolicLinkW` 会把相对目标规整成 `\`,不管 `symlinkSync` 传进去的是不是 `/`。现在夹具的 `symlinkSync` 调用和断言都改用 `join('..', 'outside')`,让期望值跟着主机符号链接层实际报告的分隔符走。

`sandbox-windows-acl/tests/runner.spec.ts` 的 `pwshAvailable()` 原来通过 `resolvePwshPath()` 探测,而它在没有真 pwsh 7 时会兜底到 Windows 自带的旧版 PowerShell 5.1(`powershell.exe`)。在验证云机上这产生了"pwsh 可用"的假阳性——runner 测试自己实际 spawn 的是裸命令 `pwsh`(纯 PATH 解析)——导致 6 个受限子进程用例真的失败而不是自跳过。探测逻辑现在直接 spawn 字面量 `pwsh` 命令,并额外检查 `$PSVersionTable.PSEdition === 'Core'`,拒绝旧版 Desktop 版本的兜底匹配。

**工作流侧**:`windows-native` job 在 `pnpm install` 之后新增:
1. "Fetch pinned micromamba (win32-x64)"——`pnpm --filter @deepseek-ai/dsh-desktop run fetch:micromamba win32-x64`,复用 `desktop-release.yml` 打包时已经在用的、经过校验和验证的同一个 micromamba 资产,而不是再引入第二个来源。
2. "Restore cached Science env" / "Create Science env (python + r-base)"——`actions/cache@v4` 按 `hashFiles('apps/desktop/resources/micromamba.json')` 加上字面量包规格作 key,缓存未命中时执行 `micromamba create -y -p $env:RUNNER_TEMP\science -c conda-forge python=3.13 r-base=4.5`。只装这两个包:这一步是为这三个包的真实解释器测试服务,不是为了对齐桌面打包,所以 `environments/general.json` 的全家桶是不必要的负担,也会拖慢缓存未命中时的建环境速度。
3. "Science on real Windows"——把 `DSH_SCIENCE_REAL_PREFIX` 指向该前缀,跑上面验证过的同一条三包 vitest 命令。这一步放在 "Run complete native Windows gate inventory" 之前,两个步骤都带 `if: always()`:任何一步的失败都不会掩盖另一步的结果,而且这个 job 本来就不在 `all-checks-passed.needs` 里(未改动)——用既有的 job 级排除,而不是步骤级 `continue-on-error`,才是这个仓库认可的不阻断机制(见[备选方案](#alternatives-considered))。

<a id="skip-inventory"></a>

## 跳过清单

下面每一行的跳过都是 `it.skipIf(process.platform === 'win32')` 或 `describe.skipIf(...)`,数字已对照实机验证跑出的跳过总数核实,见[云机验证](#cloud-verification)。

| 文件 | 跳过数 | 原因 |
|---|--:|---|
| `science-runtime/tests/kernel-process.spec.ts` | 49 | `createFakeInterpreterPrefix` 会落地 `<prefix>/bin/python`/`Rscript`,是 win32 的可执行文件布局查找永远找不到的 POSIX 形状路径 |
| `science-runtime/tests/kernel-set.spec.ts` | 36 | 同一个 `createFakeInterpreterPrefix` 夹具形状缺口 |
| `science-runtime/tests/environment.spec.ts` | 57 | 混合:`createFakePythonPrefix`/`createFakeRPrefix` 的 POSIX `bin/` 布局,以及只能通过这个夹具走到 `'applied'`/版本不匹配结果的安装路径用例 |
| `science-runtime/tests/run.spec.ts` | 40 | 经 `bindFakePython`/`readyPythonHarness` 触达的 `createFakePythonPrefix`/`createFakeRPrefix` 夹具形状缺口 |
| `science-runtime/tests/capture.spec.ts` | 29 | `createFakePythonPrefix` 夹具形状缺口 |
| `science-runtime/tests/chart-edit.spec.ts` | 26 | `createFakePythonPrefix` 夹具形状缺口 |
| `tool-science/tests/tool-science.spec.ts` | 26 | `createFakePythonPrefix` 夹具形状缺口 |
| `science-runtime/tests/annotate.spec.ts` | 17 | `createFakePythonPrefix` 夹具形状缺口(直接使用及经 `captureFiles`) |
| `science-runtime/tests/failures.spec.ts` | 9 | `createFakePythonPrefix` 夹具形状缺口 |
| `science-runtime/tests/save-as.spec.ts` | 8 | `createFakePythonPrefix` 夹具形状缺口(经 `captureFiles`) |
| `science-runtime/tests/lifecycle.spec.ts` | 5 | `createFakePythonPrefix` 夹具形状缺口(经 `bindEnvironment`/`readyKernelHarness`) |
| `science-runtime/tests/loader-composition.spec.ts` | 5 | 4 条为 `createFakePythonPrefix` 夹具形状缺口;1 条为 `/usr/bin/env` 是写死的 POSIX 绝对路径,没有 win32 对应物 |
| `science-runtime/tests/execution.spec.ts` | 2 | 1 条为 `process.platform` mock 无法重定向 `node:path` 加载时就固定的 `join()`;1 条为 Windows 没有 POSIX 的 SIGTERM 投递(`TerminateProcess` 无视任何 handler) |
| `science-runtime/tests/scratch.spec.ts` | 2 | 基于 `chmodSync` 的权限拒绝模拟——Windows 不按 POSIX 权限位那一套执行 |
| `science-runtime/tests/settings.spec.ts` | 2 | `createFakePythonPrefix` 夹具形状缺口 |
| `science-runtime/tests/prefix-manifest.spec.ts` | 1 | `createFakePythonPrefix` 夹具形状缺口 |
| `tool-science/tests/loader-composition.spec.ts` | 1 | `createFakePythonPrefix` 夹具形状缺口(经 `boot()`) |

`sandbox-windows-acl/tests/runner.spec.ts` 没有任何 win32 专属跳过:它那 14 条依赖 pwsh 的用例在任何没有真 pwsh 7 的主机上都会自跳过(这是既有的跨平台检查,本次未新增),在验证云机装好 pwsh 7 之后全部真跑真过。

<a id="cloud-verification"></a>

## 云机验证

真实 Windows 机器(`ssh pmwin`),worktree `C:\pm\wt-win-ci-verify`(挂在 `C:\pm\papermachine` 之下),分支 `ci/windows-science-signal`,提交 `a3a64f7860`(下面的测试侧验收是这个最终版本;工作流步骤复现比它早一个 `artifact-file.spec.ts` 修复,已在该条里注明)。

- **测试侧验收**(日志 `C:\pm\logs\T7-step1.json` / `T7-step1-raw.log`,UTF-16 编码):`pnpm exec vitest run packages/science/science-runtime packages/science/tool-science packages/sandbox/sandbox-windows-acl` → **0 failed,506 passed,338 skipped**(共 844)。`kernel-transport-real.spec.ts` 的 Python 和 R 两条用例在 `DSH_SCIENCE_REAL_PREFIX=C:\pm\envs\science` 下都真跑(未跳过)且通过。pwsh 7.5.4(Core)已装在 `C:\pm\pwsh7\extracted\pwsh.exe`;加入 PATH 后,`runner.spec.ts` 的全部 14 条用例都真跑且通过,不再自跳过。
- **工作流步骤复现**(日志 `C:\pm\logs\T7-step2.json` / `T7-step2-raw.log`):原样跑了新增的三个 PowerShell 步骤。"Fetch pinned micromamba (win32-x64)" 成功(sha256 对照 manifest 校验通过)。"Create Science env" 失败:抓下来的 `micromamba.exe` 在这台验证云机上会以 `STATUS_STACK_BUFFER_OVERRUN` 崩溃在 `ucrtbase.dll` 里,而且可稳定复现——连不带任何建环境参数的裸 `--version` 都会崩,排除了和 `create` 命令参数本身有关的可能。校验和对得上、匹配的 VC++ 运行时已装、独立重新抓取的第二份同一文件崩溃表现完全一致,这些都排除了下载损坏;更可能是这台验证云机自身的特有问题(它的 zh-CN 语言区域和代码页在这次任务全程都是编码摩擦的反复来源)而不是这一步本身的缺陷,尤其是 `desktop-release.yml` 早就在真实的 GitHub Actions CI 里成功抓取并跑过这同一个 pinned 二进制。根因未确认(没有可比对的 en-US Windows 机器可测),留作后续:如果在真正的 `windows-native` 跑起来时再次出现,再回头验证。由于目标前缀没有解释器,"Science on real Windows" 随后带着指向一个不存在路径的 `DSH_SCIENCE_REAL_PREFIX` 跑了起来——`kernel-transport-real.spec.ts` 按设计自跳过,三包套件其余部分跑出的跳过清单和 commit 1 验证时的[跳过清单](#skip-inventory)一致。这一次跑早于上面 `afterEach` 钩子超时的修复,复现了那个如今已修好的 `artifact-file.spec.ts` flake;修完之后没有为这一步单独重跑,因为这一步真正卡住的是建环境时的崩溃,不是测试套件。

<a id="alternatives-considered"></a>

## 备选方案

**给新增的 "Science on real Windows" 步骤加 `continue-on-error: true`。** 否决:这会让该步骤在真实失败之后仍然报告成功,而这正是本仓库自己的[原生 Windows CI Agent Note](2026-08-08-native-windows-pull-request-ci.zh.md)对整个 job 否决过的那种掩盖方式。这个 job 本来就不在 `all-checks-passed.needs` 里,这才是本仓库认可的不阻断机制;用 `if: always()` 串联,能让每一步各自的结论保持诚实,同时仍然保证下一步会执行。

**安装 `environments/general.json` 的桌面全套包。** 否决:这三个包的真实解释器测试只需要一个能用的 Python 和 R 可执行文件,不需要对齐桌面打包。更窄的 `python=3.13 r-base=4.5` 规格能让缓存更小、缓存未命中时建环境更快。

**现在就把这个 job 升级进 `all-checks-passed.needs`。** 未做:这份任务书没有授权决定 Science-on-Windows 是否应该阻断合并,而这个 Science 步骤所在的既有原生 Windows job 本身就是刻意设计成不阻断的——这该由另一个决定去重新评估,而不是这次改动。

**现在就把 `#!/bin/sh` 假解释器夹具移植到 Windows。** 否决,超出本次范围:这样做能让上面每一条跳过的用例都真正跑起来,但重新设计 `tests/harness.ts` 的夹具层、让它也能落地一个 win32 形状的假解释器,是比"让既有套件给出诚实信号"大得多的投入。

## 后果

Windows CI 现在会通过 `science-runtime`、`tool-science`、`sandbox-windows-acl` 的实际测试套件真跑 Python 和 R 内核,这个结果在 `check:ci:windows-complete` 之前独立可见,而不再是什么都不报告。上面的跳过清单是真实代价:338 个用例在其夹具被移植之前拿不到任何 Windows 信号,一个只能通过 `createFakePythonPrefix`/`createFakeRPrefix` 在 win32 上触达的缺陷,在那之前仍然不可见。是否要让这一步阻断合并,仍是一个留待之后的开放决定——这次改动只是让这个信号存在,并且诚实。

[云机验证](#cloud-verification)里的建环境崩溃,意味着这次改动自己的云机验证没能观察到一次完全成功的 "Create Science env" 步骤;留作后续,在真正的 `windows-native` 跑一次(或者换一台配置不同的 Windows 机器)确认清楚,再把那一步未来的失败当成真实回归,而不是这同一个主机特有问题的重演。
