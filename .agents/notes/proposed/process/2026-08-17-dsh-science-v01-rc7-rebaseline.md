# Agent Note: DSH Science v0.1 rc.7 rebaseline

Status: proposed

English | [中文](2026-08-17-dsh-science-v01-rc7-rebaseline.zh.md)

## Problem

The DSH Science line has tracked official rc.5 (`47f943859bef60e4160492346772ded9b24f765a`) as a fixed base since [R0](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md), by design: R0 rejected continuous upstream adoption so accepted overlay evidence would not repeatedly invalidate itself while the first version was still forming. Upstream tagged `dsh-v0.1.0-rc.7` (`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`) with 111 commits over the rc.5 tag, among them [`4366528a38`](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md): registering a settings namespace now exposes it, and `settings.plugin.item` becomes a slot keyed by namespace, so `packages/host/apiproxy` no longer holds a hardcoded exposure allowlist or a `settings-not-exposed` error code.

The proposed [R6 settings and Details](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md) plan's third checkpoint, R6c, still targets the deleted architecture: a Science settings page reachable only if `science-runtime` joined an allowlist inside a package the Science line does not own. Landing R6c on rc.5 as written meant either forking `api-proxy`'s exposure list inside this line, or asking a shared package's owner to carry a Science-specific entry ahead of the generic mechanism upstream had already built. Both options cost more than adopting the generic mechanism directly, and R6a and R6b — the two checkpoints that do not touch settings exposure — carry no dependency on which base they sit on.

## Proposal

Merge `upstream/master` at the exact rc.7 tag into `codex/science-v01-r3-science-tools-plan`, whose merge-base is the exact rc.5 tag this line already tracked, and land the result as `codex/science-v01-rc7-rebaseline`. This is a source rebaseline only: no Science product behavior changes, and R6c is not implemented in the same change.

The merge produced two conflicts, both mechanical:

- `packages/host/apiproxy/src/api-proxy.ts` — our move of `referencedImage`/`imageInEvent`/`imageBlockIn` into `@deepseek-ai/dsh-session-attachment-index` and upstream's deletion of `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES` and `settings-not-exposed` are independent edits to the same file; both deletions are kept, the now-unused `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` import is dropped, and our `PresetNotCopyableError` is kept.
- `scripts/doc-budgets.manifest.json` — our `".agents/AGENTS.md": 160` entry and upstream's raised `"AGENTS.md": 1950` ceiling for the merged root file (~1929 words) are independent entries in the same manifest; both are kept.

The five packages this fork adds (`packages/science/science-runtime`, `packages/science/science-session`, `packages/science/tool-science`, `packages/client/ui-science`, `packages/session/session-attachment-index`) move from `0.1.0-rc.5` to `0.1.0-rc.7` so the dsh release family keeps one version, per [`scripts/release/families.ts`](../../../../scripts/release/families.ts).

R6a (`f5bbcf0ff2` — Runtime settings ownership) and R6b (`bb911b9c0c` — generic Details routing) already exist as commits under the pre-rebaseline tip and need no redesign: `installSettingsSection` and the `settings.plugin.item` slot's registration path existed at rc.5, rc.7 does not touch `packages/client/ui-conversation`'s Details column or the settings seam's read/write API (confirmed by diffing `packages/settings` and `packages/client/ui-conversation` between the rc.5 and rc.7 tags), and both commits carry forward through the merge with no conflict. Their tree identity changes: any acceptance or evidence review of R6a/R6b must target their post-rebaseline commit, not the pre-rebaseline SHAs above, because the base they sit on is no longer the rc.5 tag.

## Alternatives considered

**Stay on rc.5 and fork `api-proxy`'s exposure list.** Rejected because it would take Science-line ownership of a shared generic package's settings-exposure boundary for one namespace, creating a divergence from upstream that either persists indefinitely or has to be unwound at the next rebaseline anyway. Upstream had already generalized the same need.

**Wait until after R6c ships, then rebaseline.** Rejected because R6c's settings-surface plan as written in the R6 note targets the allowlist architecture rc.7 deletes. Implementing it against rc.5 would ship a `settings.section` page keyed by allowlist membership that has to be redesigned into a keyed `settings.plugin.item` card immediately after any later rebaseline — paying the design and implementation cost twice for the same product surface. Rebaselining first means R6c is designed and built once, against the mechanism that will still be current after it ships.

**Cherry-pick just `4366528a38` onto rc.5 instead of a full rebaseline.** Rejected because the commit is not isolable from the rest of the rc.5→rc.7 settings and Client history it sits in (`packages/client/ui-settings-plugins/src/client/tab-store.ts` and its callers), and cherry-picking one upstream commit without its surrounding history would leave this line permanently unable to take a later real rebaseline without resolving the same conflicts twice — once for the cherry-pick, once for the eventual full merge.

## Acceptance criteria

- The merge-base of the rebaseline branch and `upstream/master` at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` is exactly the rc.5 tag `47f943859bef60e4160492346772ded9b24f765a`; no upstream history is skipped or squashed.
- Both conflicts resolve to keep every change on each side (no upstream deletion or Science-line addition silently dropped), recorded with the exact resolution in the merge commit body.
- Every generated artifact both sides touch (`gen-client-catalog`, `gen-cordis-api`, `gen-cordis-catalog`, `gen-tool-catalog`, `gen-config-catalog`, `gen-persistence-catalog`, `gen-module-graph`, `gen-third-party-notices`) is regenerated and matches the committed tree with zero diff.
- `typecheck`, `lint`, `build`, `doc-sync`, and the repository unit suite (`test`) pass on the merge commit. `hygiene` passes except `rescope-vendor:check`, whose failure is proven pre-existing and set-identical to the same check at the rc.5 merge-base in a disposable comparison worktree.
- `test:snapshot` and `test:web` pass with no Science fixture requiring a hand-edited expectation; any re-recorded fixture is re-recorded through its documented refresh command and its diff reviewed, never hand-edited.
- `git diff --check` is clean on the full merge range.
- `test:e2e` and real Python/R Science acceptance are explicit `NOT-RUN` in the rebaseline's own evidence when no key or isolated acceptance environment is available; a later checkpoint that depends on them reruns rather than inherits this pass.

## Risks

The rebaseline is a source-only checkpoint: it does not itself accept R6a or R6b as reviewed checkpoints, and it creates no dated evidence for either beyond what this Note and the rebaseline's own evidence record. A future R6a/R6b acceptance pass still owes its own review against the post-rebaseline tree.

Registering is now exposing for every settings namespace this line adds, not only `science-runtime`'s. The shipped `pythonPrefix`/`rPrefix` fields already use `role('secret')`, so no path value crosses the wire today, but any future Science settings field must carry the same role explicitly — there is no longer an allowlist backstop that would have kept an unmarked field off the browser by omission.

Real Python/R Conda acceptance and Desktop/release layers are not re-verified by this rebaseline; they remain exactly as `NOT-RUN` as they were before it, and nothing in this Note should be read as extending R2's or R5's real-acceptance evidence to the rc.7 tree.
