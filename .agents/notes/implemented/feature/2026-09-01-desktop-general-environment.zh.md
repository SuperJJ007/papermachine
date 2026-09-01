# Agent Note: 桌面端 onboarding 打通了它的安装路径

Status: implemented

[English](2026-09-01-desktop-general-environment.md) | 中文

## 问题

`apps/desktop` 随应用发布了一个内嵌 micromamba 可执行文件、两份学科 environment declaration（`social-science`、`biology`）、一个完整的 `DesktopEnvironmentProvisioner`，以及 `main.ts` 中的 `desktop:environments`/`desktop:provision`/`desktop:cancel-provisioning` 这三个 IPC handlers——全部实现并测试覆盖，却没有一个可从 UI 触达。`preload.ts` 只暴露了 `onboardingStatus`/`detect`/`bind`，`resources/onboarding.html` 也只提供唯一一条路径：绑定机器上已有的 conda-family 环境。这是刻意的 v1 反转（见[桌面产品 Agent Note](../../proposed/architecture/2026-08-23-science-desktop-product.zh.md)），不是疏漏，但它让一台没有 conda-family 安装的机器上的用户走到死路，只看到「未检测到可用环境」，没有任何前进方向。

这条被搁置的路径本身在末端也是坏的。`launchHost` 要求 `resolveEnvironmentBindingStatus` 返回 `bound`，而后者读取 `environment-binding.json`。Provisioning 只写入 `applied.json`，从未写过 binding。哪怕有用户找到并用上了这条安装路径，也会在等完一次数百 MB 的下载、看着两项 health check 都通过之后，撞上 `desktop host: no bound Science environment`——这个失败在已经跑过的代码里从未现形，因为根本没有代码跑到过那里。

## 决策

onboarding 现在有两条路径，都可触达：绑定已有环境（不变），或者安装一个。`resources/onboarding.html` 新增一个安装区块（概要、包清单、高级编辑器）和一个确认面板，在任何下载开始之前先说明下载体积与磁盘需求；机器上什么都没检测到时，一个默认隐藏的「已检测环境」区块取代了原来那段纯文字引导。`main.ts` 的 `startProvisioning` 把一次 provisioning 操作跑到完成，再调用新增的 `bindProvisionedPrefix`——它把发布出来的 prefix 经过 `resolveBindRequest`（与检测并绑定路径用的是同一次重新校验）送进 `writeEnvironmentBinding`。因此一个配备好的环境，绑定方式与一个检测到的环境完全一样；`launchHost` 的路由判断不需要任何改动。

`preload.ts` 给 `DesktopOnboardingBridge` 新增了 `environments()`、`provision(id)`、`provisionCustom(packages)`、`cancelProvisioning()`、`onProvisioningProgress(listener)`，全部是对 `main.ts` 里已有 handler（`desktop:provision`）或新增 handler（`desktop:provision-custom`）的薄 `ipcRenderer.invoke`/`.on` 封装。

原来的两份学科声明被替换为一份，`resources/environments/general.json`，id 为 `general`：Python 分析栈（numpy、scipy、pandas、matplotlib、seaborn、statsmodels、scikit-learn）、决定研究者自己的文件能否被读取的那部分包（openpyxl 读 Excel、pyreadstat 读 SPSS/Stata、pyarrow 读 Parquet、pillow），以及 R 栈（tidyverse、haven、broom、modelr、lme4、survey、srvyr、data.table、jsonlite）。用内嵌的 micromamba 2.9.0 对这份清单做过一次真实的 `micromamba create --dry-run` solve，解出 322 个包、下载量 494 MB，没有冲突，比声明里 520 MB 的 `estimatedDownloadBytes` 留有余量。`pandas` 被钉在 `2.3`，而不是 solver 主动提供的 `3.0.5`，因为这个产品跑的模型写的是 pandas 2.x 的写法，3.0 的破坏性变更会以让用户费解的错误形式冒出来，而不是一次受控的升级。`ggplot2`（随 tidyverse 一起进来）是硬性要求，不是偏好：`packages/science/science-runtime/assets/chart_ggplot2.R` 直接调用 `ggplot2::ggplot_build` 与 `ggsave`，缺了它，R 环境会让每一张 R chart 都失败，而不只是主动要求它的那些。`pyreadstat` 与 `haven` 分别是 Python 侧与 R 侧读取 SPSS/Stata 的路径；没有它们，社会科学研究者交给产品的一份 `.sav` 或 `.dta` 文件就无法读取，不管其余包栈多完整都没用。

`apps/desktop/src/custom-environment.ts` 在两条固定路径之外新增第三条：用户自行编写的包清单，通过 `buildCustomDeclaration` 以固定 id `custom` 发布为一份声明，经由与 shipped 声明相同的 `parseEnvironmentDeclaration`，因此一个用户键入的包 token 在抵达 solver 的 argv 之前，面对的校验与随应用发布的声明完全一致。它的 revision 是 `2026.09.<digest>`，其中 `digest` 对排序后、JSON 规范化的 `(channels, packages)` 二元组做哈希——与顺序无关（同一份清单换个顺序重列不会造出新 revision），且由内容而非时钟推导（未改动的清单不会因为进入新的一个月就变 stale 并重新配备）。`writeCustomDeclaration`/`readCustomDeclaration` 把它持久化到 `<dshHome>/desktop-environments/custom.json`，`main.ts` 的 `declarations()` 在每次启动时重新读取。没有这个文件，`resolveDisciplineStatus`（`discipline-status.ts`）会把一个 applied 的、id 已不在 shipped declarations 之列的环境报为 `unknown-discipline`——这正是自定义安装所处的状态——一个能正常工作的自定义环境会在每次启动时都被退回 onboarding，且看不出原因。

顺手修复：`scripts/translation-pairing.ts` 的 `TRANSLATION_SCOPE_GLOB_EXCLUDES` 新增了 `apps/desktop/.stage/**` 与 `apps/desktop/release/**`。`verify-translation-pairing` 曾经会走进打包后的 Host closure 与构建出的 `.app` bundle，二者都带着文档的副本，其相对链接在新的目录深度下已经解析不到目标，导致 `pnpm run doc-sync` 在任何跑过 `package:mac` 的机器上都会失败。

## 考虑过的替代方案

**删掉 provisioning 代码，而不是重新接上它。** 否决：把它搁置的那次 v1 反转，是先出货检测并绑定的深思熟虑的决定，不是「安装这件事本身是错的」的决定——[桌面产品 Agent Note](../../proposed/architecture/2026-08-23-science-desktop-product.zh.md) 明确把安装列为面向「无可检测环境的机器」的既定 fallback。这些代码已经实现、已经测试，只差一个 bug 修复就能工作；删掉它等于扔掉这些工作，再去解决这次改动本来就要解决的同一个问题。

**保留分开的学科声明（social-science、biology），不合并为一份通用环境。** 就本次改动而言否决：一个还没有学科偏好的首次安装用户，没有依据去选学科，而原来两份声明本质上是同一套 Python/R 分析栈的两个更窄的切片。一份通用环境去掉了这个选择；学科专属声明仍可作为 `declarations()` 列表里的后续条目日后加回来，不需要改变一个被选中的声明如何被配备或绑定。

**用当前日期而不是内容摘要计算自定义环境的 revision。** 否决：`resolveDisciplineStatus` 把 revision 变化当作需要重新配备的 staleness。按日期推导的 revision 会让一份没动过的自定义清单在每次日历翻页时都被标记为 stale，逼着重新下载并没有变化的包。

## 后果

机器上没有 conda-family 环境的用户，现在有一条不需要终端就能走到可用 Science workspace 的路：安装、确认下载、等待、进入 workspace，绑定方式与检测到的环境一模一样。确认面板给出的体积与磁盘需求是下载开始前唯一的提示；除了 `DesktopEnvironmentProvisioner` 自身「从缓存重试」的行为之外，没有另一套独立的可续传下载 UI。高级编辑器允许用户把 `python` 或 `r-base` 整个从清单里删掉，这会导致装完之后的 health check 失败，而且没有提交前的校验能提前拦下它——编辑器的说明文字只是提醒这一点，界面本身并不阻止。

收敛到一份 shipped 声明，意味着此前的两个学科名字在这一版里不再是可安装选项；任何已经针对它们 applied 的环境都不会被迁移，这与 pre-release 阶段「磁盘格式不做兼容承诺」的立场一致。一次自定义安装的 revision 摘要只是所请求包清单本身的函数，不是 solver 实际解出结果的函数——两份请求了相同包、但因为某个 channel 后来重新发布而解出不同结果的自定义清单会得到相同的 revision，被 `resolveDisciplineStatus` 当作可互换——这是一处被接受的不精确，与 shipped 声明固定 revision 本就带有的、对 solver 结果不敏感的性质是同一种取舍。

## 验证

`apps/desktop/tests/custom-environment.spec.ts` 覆盖了 `buildCustomDeclaration` 的 id、包透传与 health checks；与顺序无关、与内容相关的 revision；拒绝一个会以 flag 或 shell 元字符负载形式抵达 solver argv 的 token；空包清单；以及持久化的往返读写，包括一份损坏文件会响亮失败，而不是悄悄报告「没有自定义环境」。`apps/desktop/tests/onboarding.spec.ts` 针对一个被 mock 的 bridge 驱动 renderer：确认面板在任何下载调用发生之前先说明体积与磁盘，确认/取消同时把关 shipped 与自定义两条路径，自定义编辑器由 shipped 清单预填且可与之比对差异，进度更新会渲染，一次失败的下载会把页面带回可用状态，读取环境列表失败时 Install 会被禁用并显示原因。`environment-declaration.spec.ts` 钉住了单一 shipped 的 `general` 声明，以及它的包含 kernel 资产所需要的解释器与绘图包。`main.ts` 的 `startProvisioning`/`bindProvisionedPrefix` 以及 `desktop:provision-custom` handler 没有专门的单元测试：`main.ts` 是依赖 Electron 的组合层，现有测试套件（依据 harness-home 那篇 Agent Note）只通过 `HostLifecycle` 及其接线的模块间接覆盖它，而不经过 Electron 自身的 `app`/`ipcMain`。
