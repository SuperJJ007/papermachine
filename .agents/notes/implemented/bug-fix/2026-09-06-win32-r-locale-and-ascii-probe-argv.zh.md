# Agent Note: win32 上的 R locale 与非 ASCII probe argv，两者都会打断 R 的 UTF-8 无损输出检查

Status: implemented

[English](2026-09-06-win32-r-locale-and-ascii-probe-argv.md) | 中文

## Problem

一次真实 Windows Server 2022 运行中，在修好了[预先存在的 scratch 隐私、probe 排序与 confinement 转发缺陷](2026-09-06-win32-scratch-privacy-and-probe-ordering.zh.md)之后，`bindEnvironment` 仍然把 R 的观测结果报告为 `invalid`，理由是 `"interpreter probes did not produce the required lossless output"`——尽管同一台机器上 Python 的观测已经成功。这背后是两个相互独立、又叠加在一起的根因：

1. `CHILD_LOCALES.win32`(`execution.ts`)此前是 POSIX 的 `C.UTF-8`，与 linux/aix 等平台共用同一个值。在 conda-forge 的 ucrt R 4.5.3 下，`LC_ALL=C.UTF-8` 的行为与 POSIX 上不同：R 自己的 `l10n_info()$"UTF-8"` 报告为 `FALSE`，active code page 报告为 `0`。R 进程写到 stdout 的每一个非 ASCII 字节都变成了字面的 `<U+XXXX>` 转义序列而不是 UTF-8——UTF-8 probe 的 `enc2utf8(UTF8_PROBE_TEXT)` 输出永远无法与 `UTF8_PROBE_TEXT` 逐字节匹配，于是 `bindEnvironment` 在走到 package-inventory probe 之前就已经把 R 判为 `invalid`。`en_US.UTF-8` 没有这个问题：R 在它之下会把 active code page 设为 `65001`(UTF-8)，且启动时不带任何 locale 警告。已经用一个 probe 脚本在真机上直接确认、且只隔离了这一个变量：`LC_ALL=C.UTF-8` 复现了 `<U+79D1><U+5B66>` 这种转义输出；`LC_ALL=en_US.UTF-8` 复现了正确的 UTF-8 字节；两次运行之间 probe 环境的其它部分完全没有变化。
2. 与 locale 无关地，R 和 Python 的 UTF-8 probe 表达式都把字面量 `"dsh-科学-✓"` 直接嵌进了 `-e`/`-c` 的 argv 里。conda-forge 的 win32 `Scripts\Rscript.exe` 本身并不是 R 解释器——它是一个很小的 launcher 可执行文件，接收进程的命令行后通过 `CreateProcessA`(ANSI、非宽字符的进程创建 API)把命令行再转发给真正的 R 解释器。任何超出该 launcher 进程 active ANSI code page 的非 ASCII 字节，都会在这一次再转发中被破坏——早在 R 自己的 parser 看到这个表达式之前就已经损坏；R 随后报告的是一次 re-encoding 失败(`invalid multibyte string`/re-encoding error),而不是真的运行了这个表达式。Python 的 probe 完全不受这一半缺陷影响：`python.exe` 直接接收操作系统的宽字符(UTF-16)argv,中间没有 ANSI 转发的 launcher,所以它的字面非 ASCII argv 不论 active code page 或 locale 是什么都能正常工作。

这两个缺陷各自独立就足以让 R 的 UTF-8 probe 在 win32 上失败;只修好其中一个,另一个仍然会挡住 `bindEnvironment` 永远无法把 R 报告为 `capability: "available"`。

## Decision

**`CHILD_LOCALES.win32` 从 `POSIX_LOCALE`(`C.UTF-8`)改成 `'en_US.UTF-8'`**,与 darwin 对齐(这张表里此前唯一一个不是 `C.UTF-8` 的平台),而不是沿用每个 Linux 家族条目都在用的 POSIX 默认值。这是每一次被 confine 的 interpreter spawn——持久化 kernel 与 interpreter probe 都算在内——共用的同一个值,所以这一个修复能同时覆盖两条路径,不需要为其中任何一条单独开一条代码路径。

**R 和 Python 的 UTF-8 probe 表达式都把字面非 ASCII 字符换成了 `\u` 转义**(R 与 Python 源码里都是 `"dsh-\u79d1\u5b66-\u2713"`),这样 launcher 或操作系统实际转发的 argv 字节始终是纯 ASCII,不论 code page 或 locale 是什么;interpreter 自己在解析这个表达式时会把转义还原成同一个 Unicode 字符串。`UTF8_PROBE_TEXT`(`environment.ts` 里用于比对的期望解码值)保持字面量 `'dsh-科学-✓'` 不变——变的只是请求的线上表示,不是期望的响应。Python 的 probe 本身其实不需要这个修复(它的 argv 路径不受 ANSI-launcher 这个缺陷影响),但为了对称性也一起改了:两个 probe 现在对自己的传输安全性做出了同样的承诺,而不是留下一处不对称——未来某次平台或 launcher 变化可能会悄悄把同样的风险引入 Python 这条路径,而没有人会意识到这里其实一直存在过这个隐患。

## Alternatives considered

- **从环境的系统 code page 推导 win32 locale,而不是用固定的 `en_US.UTF-8`。** 否决:本 Runtime 固定的 environment allowlist 与 locale 值刻意不是随部署变化的量(`docs/cordis-primer.md` 的"不写死可调项"约定针对的是可配置的*部署*选择,不是这种情况——被 spawn 的 interpreter 要正确运行所需要的 locale,是一项固定的正确性要求,与同一个对象里的 `TZ: 'UTC'` 属于同一类)。读取宿主机当下的 code page 会让正确性依赖于本 Runtime 既不控制、在 spawn 时也无法验证的一项环境设置。
- **保留 `C.UTF-8` 作为 win32 的值。** 已有真机直接证据否决此方案:win32 的 C runtime `setlocale` 并不像 glibc 那样接受 `C.UTF-8`;请求它要么直接失败,要么悄悄退回到普通的 `C` locale,复现出本次改动要修的那个 `<U+XXXX>` 转义缺陷正是同一个。没有哪个 win32 locale 名字能给出 POSIX `C.UTF-8` 那种"无特定 locale 行为、UTF-8 编码"的语义;`en_US.UTF-8` 是真实的 ucrt R 构建能接受、且行为正确的最接近替代。
- **只给 R 的 probe 加转义,Python 保持字面量。** 出于上面同样的对称性理由否决:Python 的 argv 路径今天恰好是安全的,因为 `python.exe` 直接接收宽字符 argv,但这份安全性只是当下 win32 Python launcher 的一个事实,不是这个代码库在任何地方强制的保证。两个 probe 都加转义,就不需要再去判断"今天到底是哪个 interpreter 的 launcher 在做 ANSI 转发"。
- **检测这个做 ANSI 转发的 launcher 并绕过它(例如一个 wrapper 批处理文件、spawn 前先 `chcp 65001`,或基于 UTF-8 manifest 的 launcher 覆盖)。** 否决:这些都不在本 Runtime 的控制范围内(`Rscript.exe` 由 conda-forge 发布与控制),而一个纯 ASCII 的 argv,比任何试图改变第三方 launcher 如何转发命令行的绕行方案都更简单。

## Consequences

`packages/science/science-runtime/src/**/*.ts` 的按文件覆盖率保持 100%。`execution.spec.ts` 新增了对 `localeEnvironment()` 的直接覆盖,对比 win32(`en_US.UTF-8`)与 linux(`C.UTF-8`),把这个平台专属的覆盖值钉死下来,而不是只通过 `interpreterPathEnv` 已有的 win32 测试间接覆盖到它。`environment.spec.ts` 给 Python 与 R 两个 fake-prefix `bindEnvironment` 测试都新增了"argv 每个元素都只含 ASCII"的断言(`/^[\x00-\x7f]*$/`),这样未来任何一次重新引入字面非 ASCII 字符的 probe 表达式改动,都会在任意平台上直接跑挂一个测试,而不必等到一次真实的 win32 运行才发现。

已在真实 Windows Server 2022 机器上确认:

- `kernel-transport-real.spec.ts` 的 Python 与 R 真 driver 测试都在真实 TCP loopback transport 上端到端通过(`C:\pm\logs\v5-step2.log`,2/2 通过)——不受本次改动影响,确认已经工作的持久化 kernel 路径没有回归。
- 一次针对真实 `python.exe`/`Rscript.exe`(来自一个 Conda `science` prefix)的完整 `run-science.mts` profile 运行(`C:\pm\logs\v5-step3.log`):`bindEnvironment` 返回 `status: "applied"`,R 的 `capability: "available"`(此前是 `"invalid"`);对 `cat(enc2utf8("dsh-科学-✓"),sep="")` 的一次 `startRun` 返回的 stdout 十六进制是 `6473682de7a791e5ada62de29c93`,与期望的 `64 73 68 2d e7 a7 91 e5 ad a6 2d e2 9c 93` 完全一致(`"dsh-"` + `科学`(`e7 a7 91 e5 ad a6`)+ `"-"` + `✓`(`e2 9c 93`));Python 与 R 各自在同一个 `kernelEpoch` 上的两次运行之间都保住了内核状态(Python:`x = 4321` 再 `print(x)` → `"4321\n"`;R:`y <- 1234` 再 `cat(y)` → `"1234"`);一个 60 秒的 `time.sleep` 在 2 秒后被取消,分类为 `cancelled`;取消之后的下一次运行在一个新的 `kernelEpoch` 上成功。
- 一次独立的 `run-science-py.mts` 运行(`C:\pm\logs\v5-step3-py.log`)只针对 Python 跑了同样的 `startRun` 序列,确认结果与 profile 里是否包含 R 无关。

`packages/science/science-runtime/README.md`/`README.zh.md` 里"win32 kernel execution 只有 Python 拿到了真机确认"这条 Known Limitation 已经退休:R 的 `bindEnvironment` probe 路径现在拿到了与 Python 同等的真机确认。
