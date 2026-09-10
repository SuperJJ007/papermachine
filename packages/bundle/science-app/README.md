---
description: "PaperMachine product composition over the dsh Web application."
kind: "package-bundle"
---

# @deepseek-ai/dsh-science-app

English | [中文](README.zh.md)

## Summary

The `science` profile layers base, web-app, and science-app. This bundle selects the Science preset, supplies the PaperMachine brand row, disables the preset picker and shared HMR, and owns the Science plugin configuration. Build client artifacts with `DSH_CLIENT_BUILD_PROFILE=papermachine` and `DSH_CLIENT_TITLE=PaperMachine`.

## Table of Contents

- [Composition](#package-section-0)
- [Runtime assertions](#package-section-1)
- [Model Experience](#package-section-2)
- [Known Limitations and Deferred Work](#package-section-3)
- [Dev Note](#dev-note)

<a id="package-section-0"></a>
## Composition

The bundle's Host plugin publishes its absolute preset directory as `sciencePresetRoot`. The agent-presets row injects that value before evaluating its configured root. Preset paths therefore follow the installed bundle and do not depend on the process working directory.

Science runtime, projections, edit and read services, and attachment indexing mount on the Host. The Science UI mounts native right-Sidebar pages and a Process conversation view. The Science preset replaces the base model-facing tool rows.

The repository commands `pnpm papermachine` and `pnpm papermachine:headless "task"` select an isolated [PaperMachine application home](../../util/home-paths/README.md#papermachine-application-home). Use an explicit `PAPERMACHINE_HOME` for migration acceptance; inherited `DSH_HOME` does not select the Science CLI data directory.

<a id="package-section-1"></a>
## Runtime assertions

No runtime invariant companion is published: It composes plugin rows and a preset directory; the mounted packages own runtime state and event assertions, including the Science Session invariant.

<a id="package-section-2"></a>
## Model Experience

Indirectly, through the Science preset, which exposes Python and R execution, artifact publication, read-only workspace tools, and restricted delegation.

#### KV Cache effect

The Science persona and tool schemas remain stable for the session; runtime context changes are logged as user messages.

## Known Limitations and Deferred Work

<a id="package-section-3"></a>

- Browser use requires matching compiled Web and brand artifacts.

Use `dsh --profile science-headless` for a one-shot Science task or `dsh --profile science` for the Web surface. Configure the Host Science Runtime’s `profiles.science` with allowlisted Conda prefixes before running Python or R. The bundled Science preset provides read-only workspace tools and is not copyable.

<a id="dev-note"></a>
### Dev Note

None.
