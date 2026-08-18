# Agent Note: Exempt the self-modification feature's `cordis` namespace from the vendor rescope check

Status: implemented

English | [中文](2026-08-18-rescope-vendor-cordis-event-scope-exemption.zh.md)

## Problem

`pnpm run rescope-vendor:check` (`scripts/rescope-vendor.ts --check`) failed with 26 problems, blocking the `hygiene` aggregate at its first sub-check. Checking out the pre-Science base commit `22aa078206` reproduces the identical 26 problems, so this residue predates and is unrelated to any Science-artifacts work; it was pre-existing repository debt.

Every one of the 26 sites — `docs/event-producer-consumer{,.zh}.md`, `docs/subsystems/extensions{,.zh}.md`, `packages/api/remotes/src/remote-events.ts`, `packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx`, `scripts/gen-cordis-catalog.ts`, and every file under `packages/extensions/{cordis-client-runner,cordis-host-runner,tool-cordis,ui-cordis}/` — is the self-modification feature's own `cordis/*` typed event scope (`ctx.emit('cordis/request-run', …)`, `ctx.on('cordis/dynamic-package', …)`, the `Events` merge in `cordis-host-runner/src/types.ts`, the model-facing catalog entries in `tool-cordis/src/api-catalog.ts`), its `cordis` i18n/locale namespace (`NS = 'cordis'` in `ui-cordis/src/client/locales.ts`, `PropsLocale<'cordis'>`, the `t('cordis')` label in `PluginInventorySettingsTab.tsx`), its `@cordis` mention-trigger id (`name: 'cordis'` in `ui-cordis/src/client/index.ts`), and the matching `EVENT_SCOPE_PAGE`/doc-catalog keys that route these event names to their subsystems page. None of the 26 is a reference to the vendored `cordis` npm package the [rescope mapping](../../../../docs/rescope.md) renames to `@deepseek-ai/cordis`.

The rescope checker's generic token rule intentionally matches a quoted name optionally followed by `/subpath` — `'cordis'` or `'cordis/subpath'` — so it also catches subpath imports of the renamed package (`'cordis/context'`). That same shape matches an unrelated event name like `'cordis/request-run'`. The self-modification feature (`packages/extensions/{cordis-client-runner,cordis-host-runner,tool-cordis,ui-cordis}`, commit `4064198560`) named its own event scope, locale namespace, and mention-trigger id after the live Cordis context it inspects and mounts plugins into, but landed after `scripts/rescope-vendor.ts`'s `GENERIC_SKIPS` allowlist was last updated for a comparable bare-word collision (the `ui-agent-preset` files, where `cordis` names an agent-preset id, not a package). Nothing in the feature ever contained an unrescoped package reference; the checker's mapping had become wrong about these 26 sites.

Before concluding this, a repository-wide search for genuine unrescoped references (`from 'cordis'`, `require('cordis')`, `declare module 'cordis'`) in any of the 26 files turned up none; the only remaining bare-word hits are all handled elsewhere (Agent Notes, `docs/rescope.md`, the script itself, vendored READMEs, all already excluded by `excluded()`).

## Decision

`GENERIC_SKIPS` in `scripts/rescope-vendor.ts` gains one entry per affected file, each naming `cordis` as the skipped upstream token, following the file's own established pattern for bare-word collisions (the same mechanism the `ui-agent-preset` block already uses) rather than a new matching rule. [`docs/rescope.md`](../../../../docs/rescope.md) and its Chinese counterpart gain a bullet under "What the rename does not touch," alongside the existing entries for the Loader's `cordis:` prefix and the `cordis.yml` config family.

`pnpm run rescope-vendor:check` now passes: no residue, every exact edit landed, idempotent.

## Alternatives considered

**Match by directory prefix instead of listing files.** Rejected: 19 of the 26 files live under exactly four package directories, so a prefix match would shrink the list, but `GenericSkip`/`skipped()` currently do exact-file matching everywhere else in this script, and every other multi-file exemption (the six-entry `ui-agent-preset` block) is listed the same way. A new prefix-matching code path is a wider, less auditable change to the checker's matching logic for a cosmetic reduction in line count.

**Rewrite the 26 sites to avoid the bare `cordis` token** (for example, prefix the event names with something else). Rejected: the event names, locale namespace, and mention-trigger id are the feature's own product-facing vocabulary — already recorded verbatim in the model-visible tool catalog (`tool-cordis/src/api-catalog.ts`) and the `docs/subsystems/extensions.md` reference — not a naming accident. Renaming them to satisfy an unrelated hygiene gate would be a larger, higher-risk change with no benefit besides silencing the checker.

**Narrow the generic token regex so a name immediately followed by `/word` is excluded when `word` isn't a known subpath.** Rejected: the regex has no way to know which subpaths are legitimate without a second allowlist, and narrowing it changes matching behavior for all nine renamed packages repository-wide — a much larger blast radius than a 26-entry, file-scoped allowlist addition.

## Consequences

- `pnpm run rescope-vendor:check` passes; the `hygiene` aggregate no longer blocks on this residue.
- The exemption is scoped to exactly the 26 files that needed it and only to the `cordis` token; none of the other eight renamed packages' matching is affected, and each of these 26 files still gets checked for every other upstream name.
- A future file under the four self-modification packages that legitimately needs the npm-package rescope (a real `import … from 'cordis'`) is only caught if nobody blanket-copies one of these new `GENERIC_SKIPS` entries onto it without checking — the same risk every other per-file `GENERIC_SKIPS` entry in this script already carries, not a new one.
- The [rescope mapping doc](../../../../docs/rescope.md) and this note give the next person who hits a `cordis`-prefixed identifier from this feature a documented precedent instead of re-diagnosing it; the [original rescope Agent Note](2026-08-10-vendor-package-rescope.md) records the mapping decision this exemption sits beside.
