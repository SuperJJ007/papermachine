# PaperMachine release records

English | [中文](README.zh.md)

One record per shipped PaperMachine desktop DMG version, named `<version>.md` after `apps/desktop/package.json`'s `version` field (for example [0.1.1-rc.3.md](0.1.1-rc.3.md), [0.1.1-rc.4.md](0.1.1-rc.4.md)). Each record carries exactly three sections, in order:

- **改了什么** — what changed against the previous shipped version: features, fixes, and known issues, grouped and linked to their owning Agent Notes.
- **实机验了什么** — the on-device acceptance results for that DMG, as a table keyed by checklist item id.
- **遗留** — where each unresolved item from this release went: the next release, or the post-release queue.

A checklist item id cited in a release record's second section always names an item in [docs/product/device-checklist.md](../product/device-checklist.md), the master on-device acceptance checklist; a release record never restates an item's action or expected result, only its result and a note for that run. A version bump in `apps/desktop/package.json` requires a release record in the same change — this is a rule for whoever ships a DMG, not a gate this repository currently enforces mechanically.

Current-state product behavior, independent of any one release, lives in [docs/product/papermachine.md](../product/papermachine.md), not here.
