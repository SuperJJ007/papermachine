# Agent Note: PaperMachine 完全拥有自己的环境

Status: implemented

[English](2026-09-01-desktop-owns-its-environment.md) | 中文

> 本文档取代了[桌面端 onboarding 打通了它的安装路径](2026-09-01-desktop-general-environment.zh.md)中描述的「绑定已有环境」路径；该文档中 environment declaration、custom environment 与 DMG 相关机制仍然有效，本文档指出字段更名之处除外。

## 问题

Onboarding 曾提供两条路径：绑定用户机器上已有的 conda-family Python/R 环境，或安装随应用发布的 `general` environment。绑定已有环境意味着 PaperMachine 运行在那次安装碰巧带有的任意包、版本与 channel 配置之上——每个用户各有一条互不相同、无法复现的代码路径；无法向那个 prefix 中新增或升级某个包而不冒着破坏用户自身 Anaconda 安装的风险；首次运行还假定用户已经有一个可指向的可用 conda-family 安装。Claude Science 出于同样的理由自行发布并管理自己的环境；PaperMachine 的绑定路径正是它与之分歧的地方。

另一方面，随应用发布的 environment 唯一的下载来源是 `https://conda.anaconda.org/conda-forge`。该主机在中国大陆访问不稳定，而该产品目标研究者中相当一部分正在那里工作，这使得首次安装变成了一次没有替代方案的卡死。

## 决定

Onboarding 现在只有一条路径：安装。绑定已有环境被完全移除——`src/detection.ts`、`desktop:detect`/`desktop:bind` 这两个 IPC handlers，以及 preload bridge 的 `detect`/`bind` 方法都已删除，`resources/onboarding.html` 中的 `#detected` 分区、其两个 interpreter 分组，以及绑定/重新检测按钮也一并删除。provisioning 仍然需要的 `detection.ts` 中那一小块——`qualifyingInterpreters`，它在写入 binding 之前重新校验某个 prefix 的 interpreter 是否存在——被移到了自己的模块 `src/interpreter-presence.ts` 中，这样这项校验得以保留，而不必为了一个调用方（`main.ts` 中的 `bindProvisionedPrefix`）继续保留整个文件系统扫描器。

`resolveEnvironmentBindingStatus`（`src/environment-binding.ts`）现在不仅检查被绑定的 prefix 是否仍然存在，还检查它是否位于本应用自己的 provisioned environments root 之内，即 `<dshHome>/desktop-environments/environments/`（以 `desktopEnvironmentsRoot`/`provisionedEnvironmentsDirectory` 的形式从 `provisioning.ts` 导出，供两个模块共用，从而「属于我们」这一定义只存在于一处）。一个指向该 root 之外的 prefix 的 binding——无论是来自本次改动之前的旧版本，还是任何其他外部 conda-family 安装——都会被报告为 `invalid`，并附带说明该环境需要重新安装的原因，从而路由回 onboarding，而不是悄悄继续运行在一个本应用已不再承诺维持可用的路径上。应用菜单中的「Rebind Environment…」操作被重命名为「Change Environment…」，与它现在的行为一致：重新打开 onboarding 以安装一个不同的（或修复后的）环境，而不再是指向磁盘上已有的某个环境。

随应用发布的 `general` declaration 中原本单一的 `channels` 字段，被替换为一个有序的 `sources` 数组（`EnvironmentSource`：`id`、`name`、`channels`）。`general.json` 发布了三个源，按顺序作为完整且相互独立的 `micromamba create` 尝试执行——绝不会合并成一份 channel 清单，因为那样会让一次 solve 从不同镜像混合安装包，得到一个前后不一致的环境：

1. `tuna` —— `https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge`
2. `ustc` —— `https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge`
3. `official` —— `https://conda.anaconda.org/conda-forge`

`DesktopEnvironmentProvisioner.provision`（`provisioning.ts`）先运行 `orderSourcesFrom(declaration.sources, preferredSourceId)` 决定尝试顺序，然后循环：清空 prefix、只针对该源的 channel 运行一次 `create`，任何失败都会转到下一个源并重新清空 prefix，并通过既有的 `ProvisioningProgress` 通道汇报每一次尝试（`"Retrying via <source name> (source N of M)"`）。重试之前不会先把失败归类为网络问题还是 solve 问题——一个真正错误的包规格会在 solve 阶段、也就是下载之前就快速失败，因此把它跨三个源重试的代价只是几秒钟；这种一致的处理方式更简单，也同样诚实。取消操作若发生在某次尝试进行中会立即向外传播，而不会去尝试下一个源。micromamba 的包缓存通过同一个 `MAMBA_ROOT_PREFIX` 在每次尝试之间共享，因此某次失败的尝试已下载的包不会被下一次重新下载。全部尝试都失败时，报出的是最后一个源的错误。

`resources/environments/general.json` 中的 channel URL 现在由 `parseEnvironmentDeclaration`（`environment-declaration.ts`）按照严格的白名单（`https://` 加上 `[A-Za-z0-9._~/-]`）解析，而不是旧的裸 channel 名称正则，因为一个 channel URL 会未经转义地进入 `micromamba` 的 argv，这正是该值的 parser boundary——任何位置都不接受空白字符、控制字符或 shell 元字符。

新增模块 `src/source-selection.ts` 完全根据系统 locale 设置——`Intl.DateTimeFormat().resolvedOptions().timeZone` 与 `app.getPreferredSystemLanguages()`，两者都在 `main.ts` 中读取并以普通数据形式传入，使决策函数本身保持纯粹、无需 Electron 即可单元测试——来决定确认面板的默认源。当时区为 `Asia/Shanghai` 或任一首选语言以 `zh` 开头时，`resolveDefaultSourceId` 返回 `tuna` 镜像，否则返回 `official` channel；它从不探测可达性或测量速度。确认面板（`onboarding.ts`/`onboarding.html`）把每个提供的源都渲染成一个单选项，预选为该默认值，并且在任何下载开始之前仍然会说明下载体积与磁盘需求。用户的选择会成为上述有序回退中的第一次尝试；若它失败，其余的源仍会依次跟上。

`buildCustomDeclaration`（`custom-environment.ts`）原样沿用随应用发布的 declaration 的 `sources`，不允许用户按包挑选各自的源——自定义包清单不能选择包从何而来，只能选择要哪些包。它的 revision digest 特意只根据 `packages` 计算，不包含 `sources`：源描述的是包从哪里下载，而不是最终装了什么，因此换一个镜像（无论是用户主动选择，还是有序回退自动往后走）对同一份包清单而言，绝不能铸造出一个新 revision、迫使对一个本应完全相同的环境做多余的重新配备。

## 备选方案

- **把绑定路径保留为一个可选的「高级」设置。** 对本次改动而言予以拒绝：这样仍会留下两种磁盘格式（一个绑定的外部 prefix 和一个自有的已配备 prefix）与两条校验路径，去维护一条产品决定认为根本不应存在的路径。如果将来确实需要一个「使用我自己的环境」设置，可以从 git 历史中恢复，而不是让它带着一个已经删除的入口在代码树里休眠——这正是本分支刚刚修复过的那个缺陷（一条已实现、已测试却无法触达的路径）在另一个方向上的重演，绝不能再犯。
- **把三个源合并成一份让 micromamba 搜索的 `channels` 清单。** 拒绝：一份 conda channel 清单意味着「搜索所有这些源」，因此一次 solve 就可能从 TUNA 镜像解出 `numpy`、从官方 channel 解出 `pandas`，把不同来源的构建混在一起，极难推理或复现。整次尝试级别的重试让每个配备好的环境都能追溯到唯一一个源。
- **把每次回退失败分类为网络问题还是 solve 问题，只对网络失败重试。** 拒绝：从 micromamba 的输出中可靠地区分二者并不值得付出这份复杂度，而一个真正错误的包规格会在 solve 阶段、也就是任何下载之前就失败——把它跨三个源重试的代价只是几秒钟，因此统一重试更简单，也不会因此变得不诚实。
- **探测镜像可达性或延迟来选取默认源。** 拒绝：任务约束很明确——默认值必须完全根据系统设置（时区、语言）确定。网络探测会给首次运行增加一个缓慢且不稳定的步骤，也违背了「给出一个快速、明确、用户仍可覆盖的默认值」这一初衷。
- **把 `sources` 纳入自定义 declaration 的 revision digest。** 拒绝：源是关于包从哪里来的元数据，不是最终环境包含什么；对它取哈希会在自定义安装的有序回退每次跳到下一个源时都铸造出一个虚假的新 revision，并触发一次多余的重新配备。

## 后果

现在每个 PaperMachine environment 都由本应用自己配备到它拥有的一个 prefix 中，那个路径只有它自己会写入；用户机器上任何已有的 Anaconda/Miniconda/Miniforge/Mambaforge/Micromamba 安装，对本产品而言都不可见，也不会被它触碰。本次改动之前某个版本写入的 binding（指向任意某个已绑定的 prefix）在升级后会失效，并带着明确说明的原因路由回 onboarding，需要重新安装；这是本仓库预发布、不承诺磁盘兼容性这一立场下一次可接受、诚实的破坏性变更。中国大陆的用户无需任何配置即可获得一个可用的默认镜像，某个镜像失败也不再意味着首次运行卡死——有序回退会自动尝试下一个源，代价是在安装最终成功或报出彻底失败之前，最多多出两段失败尝试的等待（各自受该源自身 `create` 超时的约束）。detection 对找到的 interpreter 所做的 best-effort `--version` 探测，以及它为「机器上什么都没检测到」这种情况准备的引导文案，都随着它们所服务的那条路径一起消失了；`qualifyingInterpreters` 对一个刚配备好的 prefix 所做的 TOCTOU 复核，是那个模块中唯一存活下来的部分。

## 验证

`tests/environment-declaration.spec.ts` 覆盖 `sources` 数组的解析：按回退顺序排列的三个随应用发布的源、一个被拒绝的非 `https` URL、被拒绝的 shell 元字符与空白字符载荷（这是一项 parser boundary 检查，因为 channel URL 会未经转义地进入 `micromamba` 的 argv）、一个被拒绝的空 `sources` 数组、一个被拒绝的重复 source id，以及三个真实的随应用发布镜像 URL 各自被单独接受。`tests/provisioning.spec.ts` 端到端覆盖 `orderSourcesFrom` 的重排序与 provisioner 的有序回退循环：回退到下一个源，作为一次完整的重试 `create` 尝试（绝不是合并后的 channel 清单）；全部源都尝试过、全部失败时报出最后一个错误；每次尝试共用同一个 `MAMBA_ROOT_PREFIX`；一旦取消打断了某次尝试就不再尝试后续的源；以及从调用方指定的首选源开始尝试。`tests/source-selection.spec.ts` 覆盖地理默认值的两个方向（时区、语言及二者皆无的情况），以及某个 declaration 的 sources 中不含首选 id 时的回退。`tests/environment-binding.spec.ts` 覆盖：位于 provisioned root 内部的 binding 通过；位于其外（且磁盘上确实存在）的 binding 被拒绝，并给出说明需要重新安装的原因；以及 root 路径本身并不算「在其内部」。`tests/onboarding.spec.ts` 覆盖确认面板的源选择器（默认预选、覆盖它，以及所选 id 会同时传给标准与自定义两条配备调用），并断言 bridge 不再暴露 `detect`/`bind` 方法，页面也不再渲染 `#detected`/`#bind`/`#redetect` 元素。`tests/custom-environment.spec.ts` 覆盖仅 `sources` 变化时 digest 保持不变。
