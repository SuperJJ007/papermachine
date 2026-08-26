# Agent Note: 把 self-modification 功能自己的 `cordis` 命名空间从 vendor rescope 检查里排除

Status: implemented

[English](2026-08-18-rescope-vendor-cordis-event-scope-exemption.md) | 中文

## Problem

`pnpm run rescope-vendor:check`（`scripts/rescope-vendor.ts --check`）失败，报出 26 个问题，卡住了 `hygiene` 聚合检查的第一个子检查。切到 Science 工作之前的基线提交 `22aa078206` 复现出完全相同的 26 个问题，因此这份残留早于且与任何 Science artifacts 工作无关，是既有的仓库债务。

这 26 处——`docs/event-producer-consumer{,.zh}.md`、`docs/subsystems/extensions{,.zh}.md`、`packages/api/remotes/src/remote-events.ts`、`packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx`、`scripts/gen-cordis-catalog.ts`，以及 `packages/extensions/{cordis-client-runner,cordis-host-runner,tool-cordis,ui-cordis}/` 下的每一个文件——无一例外都是 self-modification 功能自己的 `cordis/*` 类型化事件 scope（`ctx.emit('cordis/request-run', …)`、`ctx.on('cordis/dynamic-package', …)`、`cordis-host-runner/src/types.ts` 里的 `Events` 合并、`tool-cordis/src/api-catalog.ts` 里面向模型的目录条目）、它的 `cordis` i18n/locale 命名空间（`ui-cordis/src/client/locales.ts` 里的 `NS = 'cordis'`、`PropsLocale<'cordis'>`、`PluginInventorySettingsTab.tsx` 里的 `t('cordis')` 标签）、它的 `@cordis` 提及触发器 id（`ui-cordis/src/client/index.ts` 里的 `name: 'cordis'`），以及把这些事件名路由到对应 subsystems 页面的 `EVENT_SCOPE_PAGE`／文档目录键。这 26 处没有一处是对[改名映射](../../../../docs/rescope.zh.md)要把 `cordis` npm 包改成 `@deepseek-ai/cordis` 的那个 vendored 包的引用。

rescope 检查器的通用 token 规则故意匹配一个带引号的名字、可选地跟一个 `/subpath`——`'cordis'` 或 `'cordis/subpath'`——这样才能捕获被改名包的子路径 import（`'cordis/context'`）。同样的形状也会匹配一个无关的事件名，比如 `'cordis/request-run'`。self-modification 功能（`packages/extensions/{cordis-client-runner,cordis-host-runner,tool-cordis,ui-cordis}`，提交 `4064198560`）把自己的事件 scope、locale 命名空间和提及触发器 id 都以它所检视、并向其中挂载插件的那个存活 Cordis context 命名，但它落地的时间晚于 `scripts/rescope-vendor.ts` 的 `GENERIC_SKIPS` 白名单上一次为类似的裸词碰撞（`ui-agent-preset` 那组文件，`cordis` 在那里是 agent-preset 的 id，不是包名）更新的时间。这个功能里从来没有出现过一处未改名的包引用；是检查器的映射对这 26 处的判断过时了。

在下这个结论之前，对这 26 个文件做过一次全仓库搜索，找真正未改名的引用（`from 'cordis'`、`require('cordis')`、`declare module 'cordis'`），一处都没有；剩下的裸词命中都已经在别处被处理（Agent Note、`docs/rescope.md`、脚本自身、vendored README，全部已经被 `excluded()` 排除）。

## Decision

`scripts/rescope-vendor.ts` 里的 `GENERIC_SKIPS` 为受影响的每个文件各增加一条记录，都把 `cordis` 记成被跳过的上游 token，沿用这个文件自己既有的裸词碰撞处理方式（与 `ui-agent-preset` 那一组已经在用的机制相同），而不是新增一条匹配规则。[`docs/rescope.md`](../../../../docs/rescope.zh.md) 及其中文版在"改名不碰什么"下新增一条，与既有的 Loader `cordis:` 前缀、`cordis.yml` 配置文件家族两条并列。

`pnpm run rescope-vendor:check` 现在能通过：没有残留，每个 exact edit 都已落地，且幂等。

## Alternatives considered

**按目录前缀匹配，而不是逐个文件列出。** 否决：26 个文件里有 19 个正好落在四个包目录下，按前缀匹配确实能缩短列表，但这个脚本里的 `GenericSkip`／`skipped()` 目前处处都是精确文件匹配，而每一个既有的多文件豁免（六条记录的 `ui-agent-preset` 那组）也是这样逐条列出的。给检查器的匹配逻辑新增一条前缀匹配的代码路径，是一次更大、更难审计的改动，换来的只是行数上的美观缩减。

**改写这 26 处以避开裸词 `cordis`**（比如给事件名加个别的前缀）。否决：这些事件名、locale 命名空间和提及触发器 id 是这个功能自己面向产品的词汇——已经原样记录在面向模型的工具目录（`tool-cordis/src/api-catalog.ts`）和 `docs/subsystems/extensions.md` 参考文档里——不是命名上的意外。为了满足一个无关的卫生门禁而改名，是一次更大、风险更高、与此无关的改动，除了让检查器闭嘴之外没有别的好处。

**收窄通用 token 正则，使紧跟 `/word` 的名字在 `word` 不是已知子路径时被排除。** 否决：这个正则没有办法在不引入第二份白名单的情况下知道哪些子路径是合法的，而收窄它会改变全仓库九个改名包的匹配行为——比一次 26 条、限定文件范围的白名单新增，波及面大得多。

## Consequences

- `pnpm run rescope-vendor:check` 通过；`hygiene` 聚合检查不再卡在这处残留上。
- 豁免范围精确限定在需要它的这 26 个文件，且只针对 `cordis` 这一个 token；另外八个改名包的匹配不受影响，这 26 个文件仍然会对其余每一个上游名接受检查。
- 未来这四个 self-modification 包下如果新增一个真的需要 npm 包改名的文件（真实的 `import … from 'cordis'`），只有在有人不加检查地把这几条新 `GENERIC_SKIPS` 记录之一原样搬到那个文件上时才会漏检——这和这个脚本里其余每一条按文件的 `GENERIC_SKIPS` 记录本来就带着的风险一样，不是新增的。
- [改名映射文档](../../../../docs/rescope.zh.md)与本篇 Note，给下一个撞见这个功能里以 `cordis` 开头的标识符的人留了一个有据可查的先例，不用重新诊断一遍；[最初的改名 Agent Note](2026-08-10-vendor-package-rescope.zh.md) 记录着这次豁免所依附的那个映射决策。
