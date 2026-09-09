---
description: "PaperMachine product composition over the dsh Web application."
kind: "package-bundle"
---

# @deepseek-ai/dsh-science-app

English | [中文](README.zh.md)

## Summary

The `science` profile layers base, web-app, and science-app. This bundle selects the Science preset, supplies the PaperMachine brand row, disables the preset picker and shared HMR, and owns the Science plugin configuration. Build client artifacts with `DSH_CLIENT_BUILD_PROFILE=papermachine` and `DSH_CLIENT_TITLE=PaperMachine`.

## Composition

The bundle's Host plugin publishes its absolute preset directory as `sciencePresetRoot`. The agent-presets row injects that value before evaluating its configured root. Preset paths therefore follow the installed bundle and do not depend on the process working directory.

The P1 skeleton leaves Science runtime, projection, edit, attachment-index, and UI rows disabled. Its temporary Science preset rejects `agent/pre-step` before a model request. P2 owns the Host entries and the replacement restricted preset; P4 owns the UI entry. Enabling these rows before their migration acceptance is unsupported.

## Model Experience

The temporary preset refuses execution and supplies no Science tool or model response.

#### KV Cache effect

None while the temporary preset rejects turns before requests.

## Known Limitations and Deferred Work

This is a migration skeleton. Science execution and the artifact sidebar are unavailable. A compiled brand package and matching Web artifacts are required for browser acceptance; configuration dumping alone does not prove browser activation.
