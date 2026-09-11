# Agent Note: Preserve Science trajectory ownership across cold pagination

Status: implemented

English | [中文](2026-09-02-science-cold-trajectory-ownership.zh.md)

## Problem

A cold Science trajectory must use the selected historical session, even while another live session is streaming or holding newer environment state.

## Decision

Process and Trajectory views consume the selected session’s admitted projection and required events. They do not borrow a global live Runtime object or the latest environment card from another conversation. Native sidebar and session registrations own placement; Science supplies its projection-derived content.

The Science trace projection proves call identity and turn/step ownership, but contains neither raw arguments nor tool results. Process takes those payloads only from loaded conversation nodes and represents each missing payload independently. A missing input is not `{}`, and a missing result proves neither pending execution nor absence from the durable log. Loading an earlier page supplies the original payload under the same call identity. Run names and recorded status remain available independently of these payloads.

Environment and run relationships are evaluated at their recorded positions, so later rebinding does not rewrite earlier trajectory facts.

## Alternatives considered

**Read global live state for a cold panel.** The panel would display another session’s environment or running task.

**Create a second trajectory history.** It would need its own synchronization and admission rules.

**Infer historical state from the latest binding.** This changes the meaning of earlier runs.

**Fill missing input with an empty object or call a missing result pending.** Both turn unavailable history into invented execution facts.

## Consequences

Cold views remain useful without a live kernel. That does not make unsupported old Science session formats readable; required-event admission applies before rendering. Native layout ownership and deterministic Science state remain separate.

The recorded Science preset snapshot pins real empty arguments, code, remaining parameters and stdout in local Process details. The cold-history browser fixture covers unavailable input/result notices and page-loaded recovery with unchanged call and artifact ownership; component tests separately retain empty, input-only and result-only payloads.

## Related

Related owners: [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md); [science-required-session-events](../architecture/2026-09-10-science-required-session-events.md).
