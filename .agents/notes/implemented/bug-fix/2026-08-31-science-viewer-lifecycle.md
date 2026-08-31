# Agent Note: Science viewer requests follow the active content

Status: implemented

English | [中文](2026-08-31-science-viewer-lifecycle.zh.md)

## Problem

One viewer displays unrelated files and artifact versions. Retaining a previous file's error can conceal the next file, placing maximize inside the editable branch excludes cross-session images, and recreating a preview callback after its response schedules the same edit again.

## Decision

Workspace file previews mount by path. Changing the active path clears both the previous result and its error before starting the next read; a response arriving after that mount ends cannot replace the active file. Successful reads and failed reads follow the same lifetime.

The artifact viewer owns the toolbar lightbox for every PNG, including project-library artifacts produced by another session. The lightbox is keyed by immutable version identity. Its availability does not depend on whether the current session can edit the artifact.

A chart's preview callback keeps its identity while its artifact, version, and injected transport remain unchanged. Publishing the returned preview image must not restart the edit panel's debounce. Only a change to pending operations or their addressed version requests another preview. This complements the Runtime's [saved-version baseline isolation](2026-08-31-chart-edit-baseline-isolation.md), which owns rendered content rather than browser request scheduling.

## Alternatives considered

Resetting only successful file content leaves failed reads attached to the next path. A second library-only lightbox duplicates the viewer's version selection and dismissal behavior. Removing the callback from debounce dependencies prevents legitimate transport or target changes from being observed.

## Consequences

Returning to a file starts a fresh read. The library and editable viewer use the same maximize state without granting editing rights to library artifacts. Preview requests remain cancellable when operations or their target change.

## Verification

Component tests cover direct file switches after success and failure, late responses, cross-session maximize/close, and one request after a title edit settles. Assembled browser fixtures exercise file-tab navigation, the shared lightbox, and the preview RPC through the mounted Science service.
