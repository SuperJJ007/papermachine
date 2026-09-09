# Agent Note: Science read Remotes and file admission

Status: implemented

English | [中文](2026-09-09-science-read-remotes.zh.md)

## Problem

Science reads must preserve session authorization after removal of the application proxy RPC interface.

## Decision

Science read methods belong to the domain rather than a Host proxy aggregate. A generated Remote service resolves live or stored sessions through SessionQuery, authorizes reads within the project selected by the session header's cwd (missing cwd denies reads), using event coordinates for session-produced artifacts and store verification for any other version in that project, and reads current metadata from the artifact store. The connection service owns authentication for the exact GET/HEAD byte route. Both routes use the same authorization function.

## Consequences

File attachments use the upstream verbatim file reference. V3 carrier scanning establishes reference membership; filename media policy and fatal UTF-8 decoding govern text preview. Image edits retain verified original bytes through explicit verbatim image admission. User-only note writers use required events and a separate projection; full historical-format migration remains a separate work package. No active note in this tree owns the removed Host proxy implementation.

## Alternatives considered

Putting domain reads into a generic session controller couples its release and dependencies to Science. Separate byte authorization would risk disagreement with Remote reads.
