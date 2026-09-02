# PaperMachine

English | [中文](papermachine.zh.md)

PaperMachine is the Science desktop product built on DeepSeek Harness: a macOS-first Electron workbench for reproducible Python/R analysis, with a persistent kernel, a versioned artifact library, and an editable chart. This page describes current researcher-facing behavior by area; each area links to the subsystem doc or package README that owns its detail. Known gaps and what changed between releases live in [the release records](../releases/README.md), not here.

## Environment install and mirrors

PaperMachine owns its Python/R environment outright: first run opens onboarding, which installs the shipped `general` environment (NumPy, SciPy, pandas, Matplotlib, seaborn, statsmodels, scikit-learn, openpyxl, pyreadstat, PyArrow, and the R tidyverse stack) into a prefix the app provisions itself — it never binds a conda-family environment already on the machine. The confirmation panel offers three package sources, tried in order as independent attempts: the TUNA mirror, the USTC mirror, and the official `conda.anaconda.org` channel, defaulting to TUNA for a `Asia/Shanghai` timezone or a Chinese system language and to the official channel otherwise; a person can start from any of the three. The running workspace keeps the same ordered fallback for `install_science_packages`. See [apps/desktop/README.md](../../apps/desktop/README.md) ("Onboarding and environment binding" and "Environment declarations").

## Python and R persistent kernels

Each session gets one persistent kernel per language, started lazily on first use: variables, imports, and definitions stay in memory across `run_python`/`run_r` calls until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end), and a run result names the restart reason when one applies. `install_science_packages` installs into the bound environment through micromamba, but the fresh package only becomes importable on that language's next run, which restarts the kernel and loses in-memory state. The run's current directory is private scratch that is never captured; output goes under `SCIENCE_ARTIFACT_DIR`, cross-restart state under `SCIENCE_STATE_DIR`, and workspace files are read through `SCIENCE_WORKSPACE_DIR` or an absolute path. See [science-runtime](../../packages/science/science-runtime/README.md) and [Science Runtime](../subsystems/science.md).

## Artifacts library and versions

Every eligible file a run writes under `SCIENCE_ARTIFACT_DIR` is captured automatically as a versioned artifact; a `.png` is captured only when the run names it in `raster_artifacts`. The Artifacts panel groups versions by producing conversation with search, sort, and grid/list controls, and a Project files tab browses the workspace directly. Opening a version shows its content origin and creation time plus a version stepper (`‹ vN ›`); "Save as copy" duplicates a version into a brand-new artifact. A non-modal reconciliation banner names any store/session-log inconsistency found when a project is first opened. See [science-artifact-store](../../packages/science/science-artifact-store/README.md) and [Artifact viewer](../../packages/client/ui-science/README.md#artifact-viewer-details-entry).

## Chart editing and region references

A PNG saved through matplotlib `savefig()`/`plt.savefig()` or ggplot2 `ggsave()` carries an addressable chart projection. The viewer's editing panel exposes direct controls for title, subtitle, axis labels, legend position, grid, and font, each producing a new version on save; every extracted element — series, annotations, axes — lists as a reference row. Clicking `+`/`−` on a row, or drawing a normalized region on the raster, stages a reference the composer sends with the next chat instruction, so a follow-up edit names an exact target instead of a screenshot description. See [Artifact viewer](../../packages/client/ui-science/README.md#artifact-viewer-details-entry) and [science-runtime](../../packages/science/science-runtime/README.md) ("Chart addressability").

## Process/Trajectory view

For a Science session, the Trajectory tab defaults to a Process view instead of the generic Detailed ledger: one card per turn shows the user's request, an ordered step strip, totals, and the artifact versions that turn produced, expandable into the exact code, arguments, and stdout/stderr behind each step. Kernel start/exit/interruption events render as timeline markers rather than a separate panel. Turn and step placement survives a full app restart and a cold reload of the conversation, reconstructed from the session's own durable trajectory index rather than which conversation pages happen to be loaded. See [ui-science](../../packages/client/ui-science/README.md) ("Process view").

## Literature MCP servers and skills

The Science persona recognizes a connected literature MCP server by its tool-name convention — `mcp__papers__*` or `mcp__arxiv__*` — and prefers it over `web_search` for literature search, citation lookup, or a paper's full text, naming its source for anything it relies on; no such server ships bundled, so connecting one is an ordinary [MCP client](../../packages/mcp/mcp-client/README.md) deployment choice. Three Science skills — `scientific-visualization`, `statistical-analysis`, `scientific-writing` — ship read-only with the desktop build and are shadowed by any same-named skill a project or the user's own `~/.papermachine/skills` provides; the agent loads a skill's instructions explicitly through the `skill` tool before writing the code it covers. See [apps/desktop/README.md](../../apps/desktop/README.md) ("Bundled default skills") and [tool-catalog.md](../tool-catalog.md).

## The restricted subagent

Science can delegate a genuinely independent sub-task — parallel work such as a literature search running alongside data exploration, or one long exploratory analysis — to a subagent through the `subagent` tool. The child starts its own kernel with none of the parent's variables, cannot install packages, delegate further (`maxDepth: 1`), message or list other agents, or enter plan mode; it reports its conclusion, key numbers, and every produced artifact's logical name back to the parent, whose own persona is instructed to verify a child's reported numbers before repeating them. See [Science Runtime](../subsystems/science.md) and the [restricted-subagent Agent Note](../../.agents/notes/implemented/feature/2026-09-02-science-restricted-subagent.md).

## Desktop shell: menus, Restart Host, Change Environment, host log

The application menu offers **Restart Host** (⌘⇧R) — stops and relaunches the Host process without losing the current session — and **Change Environment…**, which reopens onboarding while the active Host keeps serving the current workspace; both are disabled while onboarding is already open. Change Environment shows the currently applied environment's id, revision, and status at the top, defaulting to "Reinstall" (naming the download size) when the applied revision matches the standard declaration, or "Keep current environment" to return without change. Host stderr is persisted, redacted, and rotated at `<Harness home>/logs/host.log` (5 MiB active file, 2 rotations by default); every error page names this path. See [apps/desktop/README.md](../../apps/desktop/README.md).

## Settings and models

Model selection lives beside the composer, not on a Settings page: switching takes effect immediately, and the current model name shows next to the input. Settings → Plugins → Science holds the two Conda prefixes (`pythonPrefix`/`rPrefix`) the bound `science` Runtime profile uses; both are secret-typed, so a saved value never echoes back, and a change only takes effect after the next Host restart, reported as `effective`/`pendingRestart`/`notConfigured`. The API key is written once, during the onboarding Models step, through the credentials service. See [ui-science](../../packages/client/ui-science/README.md) ("Settings card") and [Settings-bound entry](../../packages/science/science-runtime/README.md#settings-bound-entry).
