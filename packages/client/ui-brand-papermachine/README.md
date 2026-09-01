# @deepseek-ai/dsh-client-ui-brand-papermachine

English | [中文](README.zh.md)

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` for the PaperMachine desktop product. Unlike `@deepseek-ai/dsh-client-ui-brand-official`, it carries no build-profile guard: the `dsh-web-app` bundle row that mounts this package ships `disabled: true`, and the desktop Host overlay is the only layer that flips it on (alongside disabling the official occupant's row), so the Web product keeps the official brand unchanged.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls, identical in structure to the official package: the row works whether it activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR. It retains no runtime state. The node half is an empty Loader seat.

`PaperMachineBrandMark` reuses `@deepseek-ai/dsh-client-ui-primitives`'s `FishLogo` verbatim — the PaperMachine mark artwork is undesigned, so both brand-mark slots keep the shared whale until a PaperMachine mark replaces it. `PaperMachineBrandName` is a text wordmark specific to this package: "PaperMachine" as one word in two font weights ("Paper" 500, "Machine" 700) sharing one theme-token ink color, rendered through the host OS font stack rather than bundled artwork or an external font file — the desktop app runs offline. Its box is 24px tall at its default font size, matching the box `BrandWordmark` occupies in the same sidebar slot at its own default size, so swapping brand plugins moves nothing else in the row.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The mark artwork is a placeholder** — `PaperMachineBrandMark` reuses `FishLogo` until a PaperMachine-specific mark is designed.
- **The package supplies one occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **Enablement is bundle-row `disabled`, not an env guard** — `packages/bundle/web-app/cordis.patch.yml` ships this row off; `apps/desktop/src/runtime-overlay.ts` is the only layer that turns it on.
