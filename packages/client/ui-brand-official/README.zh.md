# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

仅当 `DSH_CLIENT_BUILD_PROFILE` 为 `official` 时，本包才填充 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`，并提供 `clientBrand` 服务（`{ productName: 'DeepSeek Harness' }`）。其他构建仍会加载插件，但不注册 occupant 也不提供 `clientBrand`，因此显示 shell fallback 与 `ui-renderer` 的通用 document title。

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。`clientBrand` 通过同一个 fiber 提供，因此会随占位者一起在卸载时消失。它不保留运行时状态。node 半边是空的 Loader seat。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **本包只提供一组 occupant** —— 其他呈现应由占用相同 slot 的另一个 Cordis 包提供。
- **标题有两个独立来源** —— 本包的 `clientBrand` 供给运行时 document title 投影（`ui-renderer` 的 `DocumentTitle`，通过 `ctx.get('clientBrand')` 读取）；`apps/web` 构建产物 `index.html` 里预水合的 `<title>` 是另一个不相关、本包不触及的 `DSH_CLIENT_TITLE` 构建期替换（`apps/web/vite.config.ts`）。
