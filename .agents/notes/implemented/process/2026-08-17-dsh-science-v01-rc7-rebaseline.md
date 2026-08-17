# Agent Note: DSH Science v0.1 rc.7 rebaseline

Status: implemented

English | [中文](2026-08-17-dsh-science-v01-rc7-rebaseline.zh.md)

## Problem

The DSH Science line tracked official rc.5 (`47f943859bef60e4160492346772ded9b24f765a`) as a fixed base from [R0](../../archived/process/2026-08-15-dsh-science-v01-r0-release-baseline-scope.md) onward, by design: R0 rejected continuous upstream adoption so accepted overlay evidence would not repeatedly invalidate itself while the first version was still forming. Upstream then tagged `dsh-v0.1.0-rc.7` (`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`) with 111 commits over the rc.5 tag, among them [`4366528a38`](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md): registering a settings namespace exposes it, and `settings.plugin.item` became a slot keyed by namespace, so `packages/host/apiproxy` no longer holds a hardcoded exposure allowlist or a `settings-not-exposed` error code.

The third checkpoint of the proposed [R6 settings and Details](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md) plan, R6c, targeted the architecture that deletion removed: a Science settings page reachable only if `science-runtime` joined an allowlist inside a package the Science line does not own. Landing R6c on rc.5 as written meant either forking `api-proxy`'s exposure list inside this line, or asking a shared package's owner to carry a Science-specific entry ahead of the generic mechanism upstream had already built. Both options cost more than adopting the generic mechanism directly, and R6a and R6b — the two checkpoints that do not touch settings exposure — carry no dependency on which base they sit on.

## Decision

The line's base is upstream rc.7. `upstream/master` at the exact rc.7 tag is merged into the former tip `bb911b9c0c`, whose merge-base with it is the exact rc.5 tag this line already tracked, and the result lands as `codex/science-v01-rc7-rebaseline` (merge commit `ecde1b09ff`). The rebaseline changes source only: no Science product behavior changes, and R6c is not implemented in the same change.

The merge had two conflicts, both mechanical, and the resolution keeps every change from both sides:

- `packages/host/apiproxy/src/api-proxy.ts` — this line's move of `referencedImage`/`imageInEvent`/`imageBlockIn` into `@deepseek-ai/dsh-session-attachment-index` and upstream's deletion of `WEB_SETTINGS_NAMESPACES`/`PRODUCT_SETTINGS_NAMESPACES` and `settings-not-exposed` are independent edits to one file. Both deletions stand, the now-unused `SETTINGS_NAMESPACE as AGENT_PRESET_SETTINGS_NAMESPACE` import is gone, and this line's `PresetNotCopyableError` stays.
- `scripts/doc-budgets.manifest.json` — this line's `".agents/AGENTS.md": 160` entry and upstream's raised `"AGENTS.md": 1950` ceiling for the merged root file (~1929 words) are independent entries in one manifest, and both stand.

The five packages this fork adds (`packages/science/science-runtime`, `packages/science/science-session`, `packages/science/tool-science`, `packages/client/ui-science`, `packages/session/session-attachment-index`) carry `0.1.0-rc.7`, so the dsh release family keeps one version, as [`scripts/release/families.ts`](../../../../scripts/release/families.ts) requires.

R6a (`f5bbcf0ff2` — Runtime settings ownership) and R6b (`bb911b9c0c` — generic Details routing) needed no redesign: `installSettingsSection` and the `settings.plugin.item` registration path existed at rc.5, rc.7 leaves `packages/client/ui-conversation`'s Details column and the settings seam's read/write API untouched, and both commits carry through the merge without conflict. Their tree identity changed, so their reviewed identity is the post-rebaseline head, not the pre-rebaseline SHAs named here.

## Verification

The dated [rebaseline evidence](../../../../docs/evidence/2026-08-17-dsh-science-v01-rc7-rebaseline.md) owns every command, platform fact, and result; this Note owns only what counts as verified.

Source and documentation gates pass outright on the recorded head: `typecheck`, `lint`, `build`, `doc-sync`, `git diff --check` over the full merge range, and byte-identical reproduction from every generator both sides touch. `hygiene` fails only at `rescope-vendor:check`, whose 26 problems are proven set-identical to the same check at upstream rc.7 in a disposable comparison worktree — an inherited upstream gap, not a rebaseline defect.

The three suites that run wider than one package — `test`, `test:snapshot`, `test:web` — are verified against a stated standard rather than a green run, because each carries failures this line did not introduce. A failure is admitted only when it is proven set-identical at a comparison revision, or does not reproduce when its file runs alone; the evidence names every admitted failure with its cause, and no fixture is hand-edited to reach that state. Two lanes rest on the weaker half of that standard today: `test:snapshot`'s and `test:web`'s pre-existing failures are argued from isolation reruns and the earlier [R5 record](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md), not from a fresh comparison run at the rc.5 merge-base. That comparison is deferred because both lanes drive a real browser or reach the Host's native path opener, so they need a machine whose desktop is free.

Independent review of the recorded head accepted R6a, R6b, and this rebaseline, and confirmed by scripted comparison across all 539 upstream-touched files that the merge restored no upstream deletion and lost no upstream addition. `test:e2e` and real Python/R Science acceptance are `NOT-RUN`; a later checkpoint that depends on either reruns it rather than inheriting anything from here.

## Alternatives considered

**Stay on rc.5 and fork `api-proxy`'s exposure list.** Rejected because it would take Science-line ownership of a shared generic package's settings-exposure boundary for one namespace, creating a divergence from upstream that either persists indefinitely or has to be unwound at the next rebaseline anyway. Upstream had already generalized the same need.

**Wait until after R6c ships, then rebaseline.** Rejected because R6c's settings-surface plan as written in the R6 note targeted the allowlist architecture rc.7 deletes. Implementing it against rc.5 would ship a `settings.section` page keyed by allowlist membership that has to be redesigned into a keyed `settings.plugin.item` card immediately after any later rebaseline — paying the design and implementation cost twice for the same product surface. Rebaselining first means R6c is designed and built once, against the mechanism that will still be current after it ships.

**Cherry-pick just `4366528a38` onto rc.5 instead of a full rebaseline.** Rejected because the commit is not isolable from the rest of the rc.5→rc.7 settings and Client history it sits in (`packages/client/ui-settings-plugins/src/client/tab-store.ts` and its callers), and cherry-picking one upstream commit without its surrounding history would leave this line permanently unable to take a later real rebaseline without resolving the same conflicts twice — once for the cherry-pick, once for the eventual full merge.

## Consequences

R6c is designed and built once, against the generic mechanism, and `api-proxy`'s exposure behavior stays upstream's to own. The price is paid in identity, not in code: R6a's and R6b's commits now sit on a different tree than when they landed, and the dated R1–R5 evidence binds pre-rebaseline SHAs, so no earlier record extends to this tree by inheritance. R6c's implementation base is the accepted post-rebaseline head named in the [R6 note](../../proposed/feature/2026-08-17-dsh-science-v01-r6-settings-details.md)'s identity table.

Registering is now exposing for every settings namespace this line adds, not only `science-runtime`'s. The shipped `pythonPrefix`/`rPrefix` fields already use `role('secret')`, and the seam redacts the resolved value, the composition base, and the user layer alike, so no path value crosses the wire today. Any future Science settings field must carry the same role explicitly: there is no longer an allowlist backstop that would have kept an unmarked field off the browser by omission.

The comparison-run deferral above is an open verification item, not a closed one: until it runs, `test:snapshot`'s and `test:web`'s failures are attributed rather than proven pre-existing at a base revision.

Real Python/R Conda acceptance and the Desktop and release layers are not re-verified here. They remain exactly as `NOT-RUN` as they were before the rebaseline, and nothing in this Note extends R2's or R5's real-acceptance evidence to the rc.7 tree.
