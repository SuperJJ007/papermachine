---
description: "PaperMachine browser brand occupants."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-papermachine

English | [中文](README.zh.md)

## Summary

This browser plugin fills the sidebar mark, sidebar name, and conversation hero mark when `DSH_CLIENT_BUILD_PROFILE` is `papermachine`. Enable its Loader row and build client artifacts with `DSH_CLIENT_TITLE=PaperMachine` for the document title. The build owns the title; the plugin publishes no branding service.

## Table of Contents

- [Registration](#package-section-0)
- [Runtime assertions](#package-section-1)
- [Model Experience](#package-section-2)
- [Known Limitations and Deferred Work](#package-section-3)
- [Dev Note](#dev-note)

<a id="package-section-0"></a>
## Registration

The three occupants install through declaration-aware `slots.inject()` registrations and leave when their declaration or plugin is disposed. Outside a PaperMachine build the plugin contributes nothing. The node entry is inert.

The mark uses the shared `FishLogo`. The wordmark renders “PaperMachine” through the host font stack, with separate weights for its two parts and theme-token colors.

<a id="package-section-1"></a>
## Runtime assertions

No runtime invariant companion is published: It retains no mutable state; its slot occupants install and leave through effect-owned registrations.

<a id="package-section-2"></a>
## Model Experience

None, as browser presentation contributes no model input or session event.

#### KV Cache effect

None; the plugin does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="package-section-3"></a>

- The mark uses shared artwork until a PaperMachine-specific mark is available. Runtime profile changes cannot change branding baked into an existing client artifact; rebuild with the intended public environment.

<a id="dev-note"></a>
### Dev Note

None.
