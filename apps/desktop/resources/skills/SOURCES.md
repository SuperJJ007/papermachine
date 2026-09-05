# Bundled default skills

Three directories in this folder — `scientific-visualization/`, `statistical-analysis/`,
`scientific-writing/` — are sourced from the upstream repository below. Their
`references/`, `scripts/`, and `assets/` subdirectories are copied verbatim. Each
directory's `SKILL.md` body is locally rewritten to fit the model's context budget and
the Science agent's read-only-workspace tool set (`run_python`/`run_r` instead of a
shell, no `Write`/`Edit`); every guardrail and workflow step from the upstream body is
kept, either inline or moved into `references/` and linked by path. `LICENSE` is the
upstream repository's license file, also copied verbatim.

- **Source repository:** https://github.com/K-Dense-AI/scientific-agent-skills
- **Commit:** `1dd0fccf46fc3c9855c4a0c313a0c57fe4319883`
- **License:** MIT (`LICENSE` in this directory is the upstream `LICENSE.md`, unmodified)
- **Copied:** 2026-09-01

## Update method

Re-copy: delete each of the three directories, pull the target commit of the
source repository, copy `skills/scientific-visualization`,
`skills/statistical-analysis`, and `skills/scientific-writing` back into this
directory, then re-apply the `SKILL.md` body rewrite described above against the
new upstream body (rules and workflow steps carry over; wording and trigger terms
may change with the upstream content). Leave `references/`, `scripts/`, and
`assets/` unmodified. Update the commit and copy date above. Do not hand-edit
`references/`, `scripts/`, or `assets/` — a local fix belongs upstream, then flows
back through the next re-copy.

## Biology skills (authored in this repository)

Six further directories — `bulk-rnaseq-analysis/`, `single-cell-analysis/`,
`sequence-analysis/`, `survival-analysis/`, `bioassay-and-dose-response/`,
`ecology-and-diversity/` — are **not** vendored. They were written for PaperMachine
directly against the Science agent's tool set (`run_python`/`run_r`,
`SCIENCE_ARTIFACT_DIR`, `raster_artifacts`, `install_science_packages`, read-only
workspace, no shell) and against the shipped `biology` environment declaration
(`resources/environments/biology.json`). Their `scripts/` and `references/` are
first-party and may be edited in place; a fix does not need to flow through an
upstream. Each `SKILL.md` frontmatter follows the same shape as the vendored
three (`name`, `description` with Chinese trigger terms, `license`, `metadata`)
so `dsh-skill`'s catalog lists all nine uniformly.

- **License:** MIT, same as the repository (`LICENSE` at the repository root).
- **Skill authors:** PaperMachine community; see each `SKILL.md` `metadata`.
- **Environment assumption:** each skill's Installation table distinguishes
  packages shipped in `biology.json` from packages installed on demand through
  `install_science_packages`, and marks bioconda-only packages as macOS-only
  (bioconda publishes no `win-64` builds). Skills remain usable on the `general`
  environment: their first step then installs what the shipped set lacks.

## Update method (biology skills)

Edit in place. When `biology.json` gains or drops a package, update the matching
Installation table row in every skill that names it, and the health-check import
list in `biology.json`. Keep every `SKILL.md` body under roughly 1,400 words so
the catalog entry plus body stays inside the model's context budget; move detail
into `references/` and link it by path.
