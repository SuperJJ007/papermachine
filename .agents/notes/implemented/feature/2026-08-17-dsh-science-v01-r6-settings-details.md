# Agent Note: Science settings dependencies and effective profiles

Status: implemented

English | [中文](2026-08-17-dsh-science-v01-r6-settings-details.zh.md)

## Problem

Settings can load before their backing service, and saved environment configuration can differ from the profile used by a running session. Displaying either as the other misleads users.

## Decision

Settings providers declare service dependencies through injection instead of checking service presence once during plugin application. Environment profile changes are restart-only: settings expose saved and effective values separately, with secrets redacted. The effective record describes the registered configuration, not a later file read.

Science presentation uses native sidebar resources and pages. Settings ownership does not require a private Details slot or a second workspace layout.

## Alternatives considered

**Probe for a service once and skip registration when absent.** Plugin load order then determines whether the settings section exists.

**Hot-swap a running environment when settings change.** This would silently replace interpreter state and invalidate the session observation.

**Show raw saved configuration as effective state.** It can both leak secrets and claim unapplied settings are active.

## Consequences

Users can distinguish a saved change from a running profile. Registration must fail visibly on missing required dependencies; restart-only policy does not authorize discarding an active kernel. Native layout and read authorization remain with their respective owners.

## Related

Related owners: [science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.md); [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md).

Settings descriptors carry `pendingRestart`, computed from unredacted stored and effective values by the provider. The Remote and client scope preserve this boolean. Presence alone cannot distinguish two configured secret values, and comparing redacted objects loses that difference. The Science card therefore uses the Host verdict; page reloads preserve it and a Host restart clears it. Provider regression covers secret replacement and restoration, and the real Web scenario covers an initially configured profile, replacement, page reload, and Host restart.
