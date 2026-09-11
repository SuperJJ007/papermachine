# Agent Note: Client store rehydration from initialized fields

Status: implemented

English | [中文](2026-08-31-client-store-rehydration.zh.md)

## Problem

Persisted client state can lack newly introduced fields or retain transient UI state. Loading it wholesale discards initializer defaults; automatically inferring a full schema from initializer keys also loses optional saved fields absent from that initializer.

## Decision

Object-store rehydration shallowly overlays saved object fields on the initial state. A non-object, null, or array payload is rejected for an object base. Declared transient keys are restored from the initializer and omitted from serialization. The default merge retains unknown saved object keys; it is not the stricter key filter in the original proposal. Primitive and array stores retain whole-value restoration rather than gaining a generic kind validator.

Owners requiring an explicit persisted projection supply `persistence.save` and `persistence.restore`. The restore callback validates parsed JSON and returns complete state with accepted preferences. Storage and callback failures are non-fatal. Science declares transient lightbox, view, and trace-expansion state.

## Alternatives considered

**Require a version bump for every added field.** Initial defaults can preserve existing preferences without discarding them.

**Deep-merge nested objects.** Tagged unions and changed nested meanings need owner-specific validation rather than generic structural guesses.

**Treat initializer keys as a complete runtime schema.** Optional persisted keys can be absent from an initializer literal; a stricter projection needs explicit owner knowledge.

**Add a schema library solely for a shallow merge.** There is no generic field-level rule for it to enforce; owners with actual validation requirements use their restore callback.

## Consequences

Additive defaults and transient exclusion are implemented; the proposal’s universal unknown-key removal and primitive-kind rejection are not. Incompatible nested values and changed field meanings still need validation or a version decision. Generic restore does not establish semantic validity, and a custom persistence callback must own the full saved representation.

## Related

Related owners: [science-native-sidebar](2026-09-10-science-native-sidebar.md).
