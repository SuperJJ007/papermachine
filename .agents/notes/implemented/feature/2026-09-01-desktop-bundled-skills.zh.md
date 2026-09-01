# Agent Note: PaperMachine 随应用内置默认 Science skill

Status: implemented

[English](2026-09-01-desktop-bundled-skills.md) | 中文

## Problem

PaperMachine 的 `science` agent preset 已经通过自己的 `skill-filesystem` 行发现 project、custom 与 user skill,但全新的 `~/.papermachine` 安装一开始这些 root 都是空的。新用户在自己编写或从别处找来复制一份之前,拿不到任何 Science skill——而这恰恰是 skill 本应缩短路径的那类引导式分析工作流(图表设计、统计检验选择、论文撰写)最需要的冷启动场景。

## Decision

DMG 内置三个只读的默认 skill——`scientific-visualization`、`statistical-analysis`、`scientific-writing`——以原样方式 vendor 在 `apps/desktop/resources/skills/` 下,来自上游 MIT 许可的 `K-Dense-AI/scientific-agent-skills` 仓库,commit 为 `1dd0fccf46fc3c9855c4a0c313a0c57fe4319883`(`resources/skills/SOURCES.md` 记录了来源、commit、许可证、拷贝日期与重新拷贝的方法;`resources/skills/LICENSE` 是该仓库的 `LICENSE.md`,未作修改)。`electron-builder.yml` 的 `extraResources` 把该目录暂存到 `process.resourcesPath/skills`,与既有的 `environments`/`bin`/`telemetry.json` resource 一样在 asar 归档之外——这三个目录全是纯文本(Markdown、Python、JSON、CSV、`.mplstyle`),不含二进制文件或 symlink,总共约 600 KB。

`renderDesktopRuntimeOverlay`(`src/runtime-overlay.ts`)新增一个必填输入 `skillsRoot: string`,由 `main.ts` 填入 `join(resourceRoot(), 'skills')`(与 `micromambaPath()` 自身基于 `resourceRoot()` 的构造方式保持一致)。渲染出的 overlay 重新启用了 base bundle 中 host-plane 的 `skill-filesystem` 行——它在 `packages/bundle/web-app/cordis.patch.yml` 中被禁用,因为 `science` preset 在自己的 scope layer 中拥有一套本地 discovery——并带上 `providerName: bundled-skills`、`includeDefaultRoots: false`、`bundledSkillDir: <skillsRoot>`。`includeDefaultRoots: false` 让它保持为一个隔离的 provider,只发现内置 root,绝不重新扫描 preset 自己那一行已经覆盖的 project/custom/user root。

desktop 的 `--patch` overlay 在 profile boot 的 patch 栈中最后应用(bundle layer,然后 profile 自身 layer,然后 home-level 用户 layer,最后是 `--patch` overlay——见 `apps/cli/src/profile-boot.ts` 的 `allPatches`),因此它能够、也确实把 base bundle 的 `disabled: true` 翻回 `false`,与这个 overlay 已经用在 `ui-brand-official`/`ui-brand-papermachine` 上的手法一致。

启用这一行,会在 **global** skill layer 中注册第二个、独立的 `filesystem` 形态 provider,与 `science` preset 自身在 **preset** layer 中的 provider 并存。`dsh-skill` 的 registry 解析同名 skill 冲突时优先按最近的 scope layer 判定,只有在同一个 layer 内部才回退到 discovery rank(`packages/skill/skill/src/index.ts` 中 `SkillLayer` 的文档注释)。preset 的 layer 比这一行所在的 global layer 更近,因此 `~/.papermachine/skills` 下用户自己的 skill——由 preset 自身那一行发现——在与内置 skill 同名冲突时总会胜出,无论两个 root 各自的 discovery rank 如何;`BUNDLED_SKILL_RANK`(600,低于每一个默认 root)如果落在同一个 layer 内部也会产生同样的顺序,但真正起作用的机制是跨 layer 的"更近者优先",并不依赖它。

## Alternatives considered

- **在 Host 的子进程环境中设置 `DSH_BUNDLED_SKILL_DIR`,而不是加一行 overlay。** `skill-filesystem` 的 `bundledSkillDir` 配置在未设置且 `includeDefaultRoots` 为 true 时,本就默认读取这个环境变量(`apps/web/tests/scaffold.ts` 正是这么用的),`science` preset 自己那一行未配置的 `skill-filesystem` 本会自动读到它——完全不需要改 overlay。最终选择了显式的 overlay 行:环境变量在既有 overlay 测试已经断言的渲染出的 patch YAML 中是不可见的,而"隔离 provider"这个形态把内置 root 的发现边界(只有那一个目录、别无其他)变成一项显式、被测试覆盖的配置,而不是 `includeDefaultRoots` 默认值带来的隐式副作用。
- **首次启动时从网络下载 skill。** 拒绝:PaperMachine 的目标研究者用户包含中国大陆用户,无法保证能连通任意一个 skill 托管地址(与塑造 environment provisioning 镜像顺序的可达性顾虑相同);内置且离线可用的默认集合没有这层依赖。
- **把这些 skill 作为一个 package 安装进随应用发布的 `general` conda environment。** 拒绝:skill 是 agent 的 skill registry 按约定(`SKILL.md` 加 `references/scripts/assets`)发现的 prompt/指令内容,不是 kernel 会 import 的 Python/R package;把它们打包成 conda artifact 需要伪造一个没有任何运行时代码的 package,纯粹是滥用一条不相关的分发渠道。

## Consequences

全新的 PaperMachine 安装在首次启动时,面向模型的 catalog 中就已经有全部三个 skill,且处于最低优先级:任何 workspace project skill、任何 custom root,以及 `~/.papermachine/skills` 下的任何用户 skill,都会遮蔽同名的内置 skill,因此用户只需把 `<name>/SKILL.md`(或 `<name>.md`)放进自己的 skill 目录,就能覆盖或扩展默认集合,而无需改动 application payload。从上游重新拷贝内置集合(方法见 `resources/skills/SOURCES.md`)绝不会与用户自己的 skill 冲突,因为它们处于完全不同的 scope layer。这三个目录会给 DMG 增加大约 600 KB。

## Verification

`apps/desktop/tests/runtime-overlay.spec.ts` 覆盖了新增的 `skillsRoot` 字段:渲染出的 `skill-filesystem` 行的 `disabled: false` 及其确切的 `config`(`providerName`、`includeDefaultRoots`、`bundledSkillDir`),以及既有的断言——每一个 overlay entry 的 id 都能在 base web-app bundle 实际声明的行中找到。`apps/desktop/tests/bundled-skills.spec.ts` 直接实例化 `FileSystemSkillProvider`(绕过 `ctx.plugin`/registry composition——这个测试文件自身的范围用不到它),针对 `apps/desktop/resources/skills`、使用与 production overlay 渲染出的完全相同的配置,断言三个内置 skill 都能被正确、无重名地发现,`source: 'bundled'`、`provider: 'bundled-skills'`,且每个 skill 都能加载出非空的 body 与 description。
