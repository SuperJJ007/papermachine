# @deepseek-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` validates and durably commits immutable image and text bytes, then returns a serializable `ImageAttachmentRef` or `TextAttachmentRef`; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer images remain browser-owned temporary drafts. `validateImage` runs the same admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, validates every member before writing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `AttachmentError.code` uses the closed `AttachmentErrorCode` string union. Its `ImageAdmissionErrorCode` subset marks caller-correctable image-input failures; `isImageAdmissionError` recognizes that subset at runtime so each protocol adapter can map its own error vocabulary. `saveImage` commits one accepted image before any model-visible session event is published, and `readImage` verifies the content-addressed object against its logged metadata. Callers may cancel `readImage`; implementations observe cancellation around backend and verification work and preserve it instead of translating it into a storage failure.

The text family (`validateText`, `saveText`, `readText`, `textLimits`) mirrors the image family field-for-field but admits by byte cap and UTF-8 validity only — no content-format check, since `TextMediaType` (`text/csv`, `application/json`, `text/markdown`, `text/plain`) carries no byte-level signature the way a raster header does; the caller-declared media type passes through unverified against content. There is no `saveTexts` batch entry point: no current caller uploads text files the way `saveImages` batches a chat message's images. `TextAdmissionErrorCode` (`INVALID_TEXT`, `TEXT_TOO_LARGE`) marks caller-correctable text-input failures, parallel to `ImageAdmissionErrorCode`.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock` and provider adapters that resolve its durable reference.

#### KV Cache effect

Adding an image changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF images, and CSV, JSON, Markdown, and plain-text files.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- Generic binary files, audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
