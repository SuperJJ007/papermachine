# Agent Note: PaperMachine bundles default Science skills with the app

Status: implemented

English | [中文](2026-09-01-desktop-bundled-skills.zh.md)

## Problem

PaperMachine's `science` agent preset already discovers project, custom, and user skills through its own `skill-filesystem` row, but a fresh `~/.papermachine` install starts with none of those roots populated. A new user gets no Science skill until they author one themselves or find and copy one in from elsewhere — a cold start for exactly the guided-analysis workflows (figure design, statistical test selection, manuscript drafting) skills are meant to shortcut.

## Decision

The DMG ships three read-only default skills — `scientific-visualization`, `statistical-analysis`, `scientific-writing` — vendored verbatim under `apps/desktop/resources/skills/` from the upstream MIT-licensed `K-Dense-AI/scientific-agent-skills` repository at commit `1dd0fccf46fc3c9855c4a0c313a0c57fe4319883` (`resources/skills/SOURCES.md` names the source, commit, license, copy date, and re-copy method; `resources/skills/LICENSE` is that repository's `LICENSE.md`, unmodified). `electron-builder.yml`'s `extraResources` stages the directory at `process.resourcesPath/skills`, outside the asar archive like the existing `environments`/`bin`/`telemetry.json` resources — the three directories are plain text (Markdown, Python, JSON, CSV, `.mplstyle`), no binaries or symlinks, about 600 KB total.

`renderDesktopRuntimeOverlay` (`src/runtime-overlay.ts`) gains a required `skillsRoot: string` input, which `main.ts` populates as `join(resourceRoot(), 'skills')` (mirroring `micromambaPath()`'s own `resourceRoot()`-relative construction). The rendered overlay re-enables the base bundle's host-plane `skill-filesystem` row — disabled in `packages/bundle/web-app/cordis.patch.yml` because the `science` preset owns its own local discovery in the preset's own scope layer — with `providerName: bundled-skills`, `includeDefaultRoots: false`, and `bundledSkillDir: <skillsRoot>`. `includeDefaultRoots: false` keeps this an isolated provider that discovers only the bundled root, never re-scanning the project/custom/user roots the preset's own row already covers.

The desktop `--patch` overlay is applied last in the profile boot's patch stack (bundle layers, then the profile's own layer, then the home-level user layer, then `--patch` overlays — `apps/cli/src/profile-boot.ts`'s `allPatches`), so it can and does flip the base bundle's `disabled: true` back to `false`, the same pattern this overlay already uses for `ui-brand-official`/`ui-brand-papermachine`.

Enabling this row registers a second, independent `filesystem`-shaped provider into the **global** skill layer, alongside the `science` preset's own provider in the **preset** layer. `dsh-skill`'s registry resolves a duplicate skill name by nearest scope layer first, falling back to discovery rank only within one layer (`packages/skill/skill/src/index.ts`'s `SkillLayer` doc comment). The preset's layer is nearer than this row's global layer, so a user skill under `~/.papermachine/skills` — discovered by the preset's own row — always wins a same-named collision with a bundled skill, regardless of either root's discovery rank; `BUNDLED_SKILL_RANK` (600, below every default root) would have produced the same ordering within one layer, but cross-layer nearness is the actual mechanism and does not depend on it.

## Alternatives considered

- **Set `DSH_BUNDLED_SKILL_DIR` on the Host's spawned environment instead of an overlay row.** `skill-filesystem`'s `bundledSkillDir` config already defaults to this environment variable when unset and `includeDefaultRoots` is true (used exactly this way by `apps/web/tests/scaffold.ts`), and the `science` preset's own unconfigured `skill-filesystem` row would have picked it up automatically — zero overlay changes. Rejected in favor of the explicit overlay row: an env var is invisible in the rendered patch YAML the existing overlay tests already assert against, and the isolated-provider form makes the bundled root's discovery boundary (nothing but the one directory) an explicit, tested config rather than an implicit side effect of `includeDefaultRoots`'s default.
- **First-launch download of skills from the network.** Rejected: PaperMachine's target researchers include mainland China users where reachability to an arbitrary skills host is not guaranteed (the same reachability concern that shapes the environment provisioning mirror order); a bundled, offline-available default has no such dependency.
- **Install the skills into the shipped `general` conda environment as a package.** Rejected: skills are prompt/instruction content the agent's skill registry discovers by convention (`SKILL.md` plus `references/scripts/assets`), not Python/R packages the kernel imports; packaging them as a conda artifact would need a fabricated package with no runtime code, purely to abuse an unrelated distribution channel.

## Consequences

A fresh PaperMachine install has all three skills available in the model-facing catalog on first launch, at the lowest priority: any workspace project skill, any custom root, and any user skill under `~/.papermachine/skills` shadows a same-named bundled one, so a user can override or extend the default set by dropping a `<name>/SKILL.md` (or `<name>.md`) under their own skills directory without touching the application payload. Re-copying the bundled set from upstream (`resources/skills/SOURCES.md`'s documented method) never conflicts with a user's own skills, since they live in entirely separate scope layers. The three directories add about 600 KB to the DMG.

## Verification

`apps/desktop/tests/runtime-overlay.spec.ts` covers the new `skillsRoot` field: the rendered `skill-filesystem` row's `disabled: false` and its exact `config` (`providerName`, `includeDefaultRoots`, `bundledSkillDir`), alongside the pre-existing assertion that every overlay entry id matches a row the base web-app bundle actually declares. `apps/desktop/tests/bundled-skills.spec.ts` instantiates `FileSystemSkillProvider` directly (bypassing `ctx.plugin`/registry composition, which this test file's own scope does not need) against `apps/desktop/resources/skills` with the exact config the production overlay renders, and asserts the three shipped skills are discovered with correct, non-colliding names, `source: 'bundled'`, `provider: 'bundled-skills'`, and a non-empty loaded body and description for each.
