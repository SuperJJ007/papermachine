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
