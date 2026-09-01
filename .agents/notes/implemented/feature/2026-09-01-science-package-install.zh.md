# Agent Note: 通过有序 micromamba channel 完成 Science 装包

Status: implemented

[English](2026-09-01-science-package-install.md) | 中文

## 问题

Science session 能对着已绑定的 Conda prefix 跑代码，却无法向其中新增一个包。模型唯一可走的路是在内核里执行 `pip install` 或 `install.packages()`，其效果只存在于运行中内核的内存里，并在下一次内核重启时消失——空闲过期、崩溃、中断升级或 session 结束——而持久化的 environment 记录中没有任何一处记下这个包曾经存在。于是，一位研究者要来的库，在它悄无声息地失效之前一直可用。

`ScienceRuntime` 此前已带有可选的 `micromambaPath` 与 `installPackages` 操作，但该操作把每一次安装都钉死在字面 channel 名 `conda-forge` 上，它解析到 `https://conda.anaconda.org`。[PaperMachine 通过一组有序镜像自行安装环境](2026-09-01-desktop-owns-its-environment.zh.md)，正是因为该主机在中国大陆不可靠。一位经由 TUNA 或 USTC 镜像创建环境的桌面端用户，此后的每一次安装都会卡在或失败于其机器根本访问不通的主机上。

## 决定

**装包只走 micromamba。** `installPackages` 绝不回退到 `pip`/`install.packages()`，`INSTALLER_NOT_CONFIGURED` 是一次响亮的拒绝，而不是悄悄降级为内核内安装。进入持久化 environment 记录的包，是 micromamba 解算进 prefix 的那一个。

**`installChannels` 是一份整次重试的有序列表，不是一个 channel 集合。** `Config.installChannels`（`packages/science/science-runtime/src/config.ts`）是一份有序、非空的 `https://` conda channel URL 列表。`installPackages` 按顺序为每个条目各跑一次完整、独立的 `micromamba install --yes --no-rc --prefix <prefix> --override-channels --channel <一个 URL> <packages>`，在第一次成功处停止。`installArgv` 只接受一个 `channelUrl`，也表达不出别的。只有 `'failed'` 的一次尝试才会去试下一个 URL：`'cancelled'` 与 `'timed-out'` 立即停止，因为每次尝试共享本次调用持有的同一个 `OperationControl`，重试只会观察到同一个 deadline 与同一个 abort signal。每次尝试各自创建并清理自己的安装 scratch 目录。这正是桌面端 provisioning 对 `micromamba create` 已经采用的整次尝试形态。

**`micromambaPath` 与 `installChannels` 必须同时配置。** 只设其一时，`resolveConfig` 抛出 `science-runtime: micromambaPath and installChannels must be configured together, or neither`，于是半配置的部署在 load 时失败，而不是在第一次安装时才失败。每个 channel URL 都在 config 解析时按 `CHANNEL_URL` 校验——`https://` 加上字母、数字与 `._~/-` 的固定白名单，与 `apps/desktop/src/https-url.ts` 所用正则逐字节一致——因为该值未经转义就进入 `micromamba` argv；同时按 `MAX_INSTALL_CHANNELS`（16）校验条目数。schemastery 会把省略的可选数组规范化为 `[]`，因此空的 `installChannels` 读作未配置。`ScienceRuntime` 在构造时把两个各自可选的已解析字段收窄为一个 `installer: { micromambaPath, channels } | undefined`，此后没有任何调用点再重复检查这一配对。

**安装成功后内核懒重启，走既有的 `environment-rebound` 路径。** `installPackages` 重新观测 profile 并追加一条全新的整值 `science/environment-bound` revision；它不杀任何内核，也不启动任何内核。`ScienceKernelSet.acquire` 早已会在活内核的 `environmentRevision` 与已生效 revision 不再匹配时以 `environment-rebound` 结束该内核，并启动新的 epoch。因此该语言的下一次 `run_python`/`run_r` 会重启，而 run 结果本就会点名这一原因。装包没有引入新的事件、新的结束原因或新的重启路径。工具结果在同一轮里直接陈述这一后果：`environment revision <n> applied — this takes effect on the next run_python/run_r call for this language, not now: that call restarts the kernel (an environment re-bind) and every variable, import, and definition it currently holds in memory is lost then`。

**一个工具 `install_science_packages`，接受 `language` 与 `packages`。** 它是该能力的 Consumer 一侧，与其他 Science 变更类工具一样经 `requireDirectDispatch` 派发；与 `run_python`/`run_r`/`annotate_artifact` 不同，它不携带自己的 `toolCallId`/`requestHeaderSeq` 溯源，与 `bindEnvironment` 自身的整值追加形态一致。它的 render intent 是 `generic` 且不带编辑器 location，与其他每个 Science 工具一致：安装没有文件可展示，而 presenter 是 `args` 的纯函数，`args` 里没有任何 Host 路径可渲染。

## 备选方案

- **把所有已配置 channel 作为一个 `--channel` 列表交给一次 `micromamba install`。** 已否决：conda 的 channel 列表语义是「在这些里都搜、取最优匹配」，不是「回退」。一次解算可能把一个包解析自镜像、另一个包解析自官方主机，在同一个 prefix 里混合构建来源；而一个可访问但陈旧的镜像会悄悄压过官方 channel，而不是被跳过。整次重试让每一组已安装的包都可追溯到确切的某一个 channel。与桌面端 provisioning 的否决理由相同。
- **对任何非成功结果都重试下一个 channel。** 已否决：`'cancelled'` 与 `'timed-out'` 是本次调用的属性，不是 channel 的属性。每次尝试共享同一个 `OperationControl`，重试会立即 abort，只会在记录里多添一次误导性的尝试。
- **把失败区分为网络失败与解算失败，只重试网络失败。** 已否决，理由与 provisioning 一致：micromamba 的输出无法可靠区分二者，而一个真正写错的包 spec 会在任何下载之前于解算阶段失败，把它在整份列表上重试也只花几秒。
- **安装成功后立即重启受影响的内核。** 已否决：那会在模型并未要求丢弃的时刻销毁它可能仍在使用的内存状态，并且需要在 `environment-rebound` 之外再建一条产生相同持久化事实的重启路径。推迟到下一次 run，把何时支付重启代价的选择留给调用方，并复用同一套机制。
- **拆成 `install`/`uninstall`/`list` 三个工具。** 已否决：`get_science_state` 已经报告每种语言完整的包清单，`list` 会重复一个模型可见面；uninstall 没有产品需求，还会让模型删掉 environment declaration 所承诺的包。三个工具会让 Science 名单为一项能力增长三个而不是一个。
- **按语言各设一个工具（`install_python_packages`/`install_r_packages`）。** 已否决：`run_python`/`run_r` 之所以是两个工具，是因为它们的 `code` 参数是模型书写的两种不同语言；conda 包 spec 只有一种语法，所以语言是参数，不是工具。
- **采用 `terminal` render intent，展示 micromamba 调用。** 已否决：该调用会点名 Host 的 micromamba 路径与 channel URL，而 presenter 只能读取 `args`，其中两者都没有。模型结果本就携带有界的 stdout/stderr 尾部供检视。
- **把安装 channel 做成 `run_python`/`run_r` 的参数或工具的每次调用参数。** 已否决：某个部署可以访问哪些镜像是 Host 策略，不是模型的决定，而模型选出的 URL 会进入 `micromamba` argv。

## 后果

经由某个镜像安装环境的部署，此后也经由同一个镜像装包。只配置了 `micromambaPath` 而没有 `installChannels`（或相反）的部署不再能 load——包括任何此前只设 `micromambaPath` 的既有配置，本仓库的预发布立场接受这是一次响亮的破坏，而不是给出一个默认值。模型多了一个工具，以及一条常驻指引：内核内的 `pip install`/`install.packages()` 是临时的；`run_python`/`run_r` 的描述现在点名 `install_science_packages`，取代原来的「一项独立操作」。

一次安装在成功的那个 channel 之前，要为每个失败 channel 付出完整延迟，而且每次调用都如此：没有任何地方记住上一次成功的 channel，每次调用都从列表第一项重试。失败的安装返回最后一次尝试的有界 stdout/stderr 尾部；更早尝试的输出不随结果带出。这两处缺口都记录在 `packages/science/science-runtime/README.md` 的 Known Limitations 中。

## 测试

`packages/science/science-runtime/tests/environment.spec.ts` 覆盖 config 解析（双向的同时配置要求、空数组的未配置状态、直接抵达 `resolveConfig` 的非数组值、针对 `http://`、空白、`;` 与反引号载荷的字符白名单、三个真实发布镜像 URL，以及条目上限）与回退循环（第一个 channel 失败后试下一个并由第二个追加新 revision、全部 channel 失败且不追加 revision、以及在飞尝试被取消后不再试后续 channel）。`packages/science/science-runtime/tests/install.spec.ts` 钉住一次 argv 只点名一个 channel。`packages/science/tool-science/tests/tool-science.spec.ts` 覆盖该工具的值展平、takes-effect 文案，以及无 Runtime、嵌套派发、未配置安装器与成功四条路径。`science-tools` 无密钥 headless snapshot（`examples/headless-agent`）对着一个 fixture micromamba 可执行文件驱动一次安装回合，并断言持久化的第二条 `science/environment-bound` revision、抵达模型的指引与结果文本，以及下一次与安装无关的 `run_python` 调用报告 `kernel restarted (environment re-bind)`——端到端证明懒重启。`apps/cli/tests/web-agent-presets.e2e.ts` 与 `apps/web/tests/science-preset.snapshot.ts` 钉住该 preset 的工具名单。
