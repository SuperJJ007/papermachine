# @deepseek-ai/dsh-client-ui-brand-papermachine

[English](README.md) | 中文

本包为 PaperMachine 桌面产品填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。与 `@deepseek-ai/dsh-client-ui-brand-official` 不同，本包不带构建 profile 守卫：挂载本包的 `dsh-web-app` bundle 行默认 `disabled: true`，只有桌面端 Host overlay 这一层会把它打开（同时禁用官方 occupant 所在行），因此 Web 产品的官方品牌保持不变。

三个 occupant 通过嵌套的 `slots.inject()` 作为一组声明感知注册安装，结构与官方包一致：无论该行先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部 occupant，HMR 期间不会留下混合品牌。它不保留运行时状态。node 半边是空的 Loader seat。

`PaperMachineBrandMark`原样复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `FishLogo`——PaperMachine 的标记美术尚未设计，因此两个 brand-mark slot 目前都沿用共享的鲸鱼标，直到有 PaperMachine 专属标记替换它。`PaperMachineBrandName` 是本包特有的文字字标："PaperMachine" 作为一个词，用两种字重呈现（"Paper" 500、"Machine" 700），共享同一个主题 token 墨色，通过宿主操作系统的字体栈渲染，而不是打包美术或外部字体文件——桌面应用离线运行。它在默认字号下的高度盒为 24px，与 `BrandWordmark` 在同一侧边栏 slot、默认尺寸下占据的高度盒一致，因此更换品牌插件不会让该行的其它内容位移。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **标记美术是占位物** —— `PaperMachineBrandMark` 沿用 `FishLogo`，直到 PaperMachine 专属标记设计完成。
- **本包只提供一组 occupant** —— 其他呈现应由占用相同 slot 的另一个 Cordis 包提供。
- **启用方式是 bundle 行的 `disabled`，不是环境变量守卫** —— `packages/bundle/web-app/cordis.patch.yml` 中该行默认关闭；只有 `apps/desktop/src/runtime-overlay.ts` 这一层会把它打开。
