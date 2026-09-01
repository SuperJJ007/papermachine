# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark`, and provides the `clientBrand` service (`{ productName: 'DeepSeek Harness' }`), only when `DSH_CLIENT_BUILD_PROFILE` is `official`. Other builds load the plugin but register no occupants and provide no `clientBrand`, leaving the shell fallbacks and `ui-renderer`'s generic document title visible.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. `clientBrand` provides through the same fiber, so it disappears alongside the occupants on unload. It retains no runtime state. The node half is an empty Loader seat.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package supplies one occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **Two independent title sources** — this package's `clientBrand` feeds the runtime document-title projection (`ui-renderer`'s `DocumentTitle`, read through `ctx.get('clientBrand')`); the pre-hydration `<title>` baked into `apps/web`'s built `index.html` is a separate, unrelated `DSH_CLIENT_TITLE` build-time substitution (`apps/web/vite.config.ts`) that this package does not touch.
