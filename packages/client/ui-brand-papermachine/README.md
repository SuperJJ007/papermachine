---
description: "PaperMachine browser brand occupants."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-papermachine

English | [中文](README.zh.md)

## Summary

This browser plugin fills the sidebar mark, sidebar name, and conversation hero mark when `DSH_CLIENT_BUILD_PROFILE` is `papermachine`. Enable its Loader row and build client artifacts with `DSH_CLIENT_TITLE=PaperMachine` for the document title. The build owns the title; the plugin publishes no branding service.

## Registration

The three occupants install through declaration-aware `slots.inject()` registrations and leave when their declaration or plugin is disposed. Outside a PaperMachine build the plugin contributes nothing. The node entry is inert.

The mark uses the shared `FishLogo`. The wordmark renders “PaperMachine” through the host font stack, with separate weights for its two parts and theme-token colors.

## Model Experience

Browser presentation contributes no model input or session event.

#### KV Cache effect

None; the plugin does not assemble provider requests.

## Known Limitations and Deferred Work

The mark uses shared artwork until a PaperMachine-specific mark is available. Runtime profile changes cannot change branding baked into an existing client artifact; rebuild with the intended public environment.
