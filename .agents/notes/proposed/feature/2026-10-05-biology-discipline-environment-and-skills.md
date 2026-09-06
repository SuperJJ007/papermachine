# Biology discipline: environment declaration and six domain skills

- **Status:** proposed
- **Scope:** `apps/desktop/resources/environments/biology.json`, `apps/desktop/src/main.ts`, `apps/desktop/src/telemetry.ts` (type widening), `apps/desktop/resources/onboarding.html` / `src/onboarding.ts` (discipline picker), `apps/desktop/resources/skills/{bulk-rnaseq-analysis,single-cell-analysis,sequence-analysis,survival-analysis,bioassay-and-dose-response,ecology-and-diversity}/`, `apps/desktop/resources/skills/SOURCES.md`, `README.md` (What is inside / Roadmap)
- **Related:** [desktop owns its environment](../../implemented/feature/2026-09-01-desktop-owns-its-environment.md), [science desktop product](../../proposed/architecture/2026-08-23-science-desktop-product.md), README Roadmap item "Discipline environments"

## Problem

PaperMachine ships one environment (`general`) and three discipline-neutral skills. A biologist opening the app hits three walls in the first session: the shipped stack has no sequence, single-cell, survival, or community-ecology library, so the model's first `run_python` fails on `import scanpy`; the three bundled skills give no domain workflow, so the model improvises RNA-seq QC or a PERMANOVA from memory and skips the checks a reviewer looks for (low-count filtering rule, dispersion test beside PERMANOVA, risk table under a KM curve); and the Host overlay's `installChannels` come only from `general`'s conda-forge sources, so `install_science_packages` cannot reach bioconda even when the user asks for DESeq2 by name.

The README Roadmap already names discipline environments as the next step. This note proposes biology as the first one, because the shipped tool surface (Python + R kernels, PNG capture via matplotlib/ggplot2, CSV auto-capture) already matches how computational biology is done and because the discipline's two platforms of choice (macOS, Windows) are exactly the ones the desktop ships.

## Design

### Environment declaration

`biology.json` is a **superset of `general`** (a prefix binds both interpreters, so a user who switches disciplines loses nothing), adding on the Python side `biopython`, `scanpy`, `anndata`, `leidenalg`, `python-igraph`, `umap-learn`, `lifelines`, `scikit-posthocs`, and on the R side `survival`, `survminer`, `vegan`, `ape`, `phangorn`, `pheatmap`, `ggpubr`, `rstatix`, `emmeans`, `drc`. Every added package resolves from **conda-forge alone** on all three shipped platforms, so `supportedPlatforms` stays complete and the three-source fallback keeps the same success probability as `general`.

Each source lists **two channels**: the conda-forge mirror and the bioconda mirror of the same provider (TUNA and USTC both mirror bioconda). Provisioning does not need bioconda for the declared set — the second channel exists so that the overlay's `installChannels`, once derived from the applied declaration rather than from `general`, let `install_science_packages r bioconductor-deseq2` succeed on macOS. Bioconductor packages are deliberately **not** in the declaration: bioconda publishes no `win-64` builds, so declaring them would remove Windows from `supportedPlatforms`; and DESeq2/clusterProfiler pull `org.*.eg.db` annotation trees that would roughly double the download. The skills install them on demand and name `pydeseq2`/`gseapy` (bioconda `noarch`, installable on Windows) as the equivalent path.

Sizing: ~780 MB download, 8 GB free (`general` is 520 MB / 6 GB). The revision is `2026.10.1`. Version pins follow `general`'s `name=major.minor` style; the `TOKEN` grammar admits `=` but not `>=`, so no range pins.

### `main.ts`

`SHIPPED_ENVIRONMENT_ID` becomes the ordered list `SHIPPED_ENVIRONMENT_IDS = ['general', 'biology']`. `declarations()` returns every shipped declaration plus the custom one; the custom editor still seeds from `general`. `writeRuntimeOverlay` resolves the **applied** declaration through `provisioner(dshHome).applied()` and uses its sources for `installChannels`, falling back to `general`'s when no applied declaration resolves (a binding from a build before this change). `environment.installed` telemetry reports the shipped discipline id — a closed build-time vocabulary — and `'custom'` as before; the `TelemetryEvent` type widens from `'general' | 'custom'` to the shipped id union plus `'custom'`.

The onboarding renderer already receives an array from `desktop:environments`; it gains a radio list rendered from that array (name, package count, download size) with `general` preselected, and passes the chosen id to `desktop:provision`. "View the full package list" and the advanced editor read from the selected declaration. `resolveDisciplineStatus` needs no change: it already matches by id and revision across the list.

### Skills

Six skills, each a `SKILL.md` plus first-party `scripts/` and `references/`, written to the same frontmatter and body discipline as the vendored three (Chinese trigger terms in `description`, an Installation table that routes through `install_science_packages`, a numbered workflow, integrity rules, a quick reference, and links into `references/`). Each body stays under ~1,400 words. Choice of the six follows what a biology user asks in a first week: bulk RNA-seq DE + enrichment; single-cell scanpy pipeline with pseudobulk DE; sequence handling and phylogenies; survival analysis; wet-lab assay fitting (IC50, growth curves, qPCR, standard curves); and community/microbiome diversity. Every skill degrades gracefully on the `general` environment (its Installation step installs what is missing) and states which packages are macOS-only.

The skills are **not vendored** from `K-Dense-AI/scientific-agent-skills`: that repository's biology entries assume a shell, `Write`, and network access, and their bodies exceed the context budget the three vendored skills were rewritten to. Authoring against the Science tool set directly is smaller than rewriting, and keeps `scripts/` editable in-tree. `SOURCES.md` records this split.

### What stays out

- No new Cordis plugin or `ctx` service: the discipline surface is data (a declaration) plus skills, exactly the extension points the desktop already exposes. A biology-specific tool (e.g. a BLAST runner) would need a `ctx.subprocess`-backed capability and an approval policy; that is a separate note.
- No default environment change: `general` remains preselected.
- No bundled reference databases (gene sets, annotation DBs); skills fetch them through the package's own network path or ask for a local file.

## Consequences

- Windows users get every declared package and the Python DE/enrichment path; Bioconductor stays macOS-only and every skill says so up front.
- The overlay now depends on `applied.json`; a missing pointer falls back to today's behaviour.
- `resources/environments/` gains a second declaration the release workflow must ship; `verify` steps for declarations (schema parse) already run per file.
- Nine bundled skills instead of three: the `/` catalog entry grows by six lines; skill bodies load only when invoked.

## Verification

1. `pnpm run typecheck` (main.ts, telemetry type).
2. `apps/desktop` unit tests: declaration parser on `biology.json`; `declarations()` returns two shipped entries; overlay sources follow the applied declaration and fall back to `general`.
3. On macOS arm64 and Windows x64: provision `biology` from each source; both health checks pass; `install_science_packages r bioconductor-deseq2` succeeds on macOS and fails cleanly on Windows with the Runtime's stdout showing no bioconda candidate.
4. Invoke each skill via `/` on a small public dataset (airway counts, pbmc3k, a 16S ASV table, `lung` from R survival) and confirm the declared PNGs are captured and the CSV artifacts appear.
