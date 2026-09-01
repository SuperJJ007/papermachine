# Bundled default skills

Three directories in this folder — `scientific-visualization/`, `statistical-analysis/`,
`scientific-writing/` — are copied verbatim, including their `references/`, `scripts/`,
and `assets/` subdirectories, from the upstream repository below. `LICENSE` is that
repository's license file, also copied verbatim.

- **Source repository:** https://github.com/K-Dense-AI/scientific-agent-skills
- **Commit:** `1dd0fccf46fc3c9855c4a0c313a0c57fe4319883`
- **License:** MIT (`LICENSE` in this directory is the upstream `LICENSE.md`, unmodified)
- **Copied:** 2026-09-01

## Update method

Re-copy: delete each of the three directories, pull the target commit of the
source repository, copy `skills/scientific-visualization`,
`skills/statistical-analysis`, and `skills/scientific-writing` back into this
directory unmodified, and update the commit and copy date above. Do not
hand-edit the copied files — a local fix belongs upstream, then flows back
through the next re-copy.
