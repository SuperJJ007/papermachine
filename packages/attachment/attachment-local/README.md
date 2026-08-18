# @deepseek-ai/dsh-attachment-local

English | [中文](README.zh.md)

The private local implementation of [`@deepseek-ai/dsh-attachment`](../attachment). Objects land at `<DSH_HOME>/attachments/v1/objects/<sha256-prefix>/<sha256>` and are addressed by an opaque `sha256:` id; storage is fully shared across media families — content addressing never encodes media type in the path, so an image and a text file with identical bytes publish to the same object. Each process proves a home durable once by syncing every ancestor entry to the filesystem root, so a directory another process created but has not yet synced is never mistaken for a safe boundary. Writes then use a private staging directory, owner-only files, a synced temporary file, an atomic exclusive hard-link publish, and directory syncs on the publication path (POSIX; Windows relies on filesystem metadata journaling) so the reported reference survives a crash. Image write admission and reads fully decode the raster before accepting its format and dimensions; reads also re-check the digest and logged metadata. Text write admission checks only the byte cap and UTF-8 validity — no raster-style decode, no content-format check — and reads re-check the digest and byte length. Byte and pixel limits are write-time admission policy, so a later policy reduction does not make already-admitted history unreadable.

`DSH_HOME` resolves through the shared path policy: explicit config, `$DSH_HOME`, then `~/.dsh`. Session logs contain only the reference and verified metadata, never this host path. `readImage` and `readText` forward optional cancellation into the filesystem read, observe it around verification, and preserve it instead of wrapping it as `ATTACHMENT_READ_FAILED`. `Config.maxTextBytes` (default `DEFAULT_MAX_TEXT_BYTES`, 5 MiB, matching `DEFAULT_MAX_IMAGE_BYTES`) is the only text admission bound; the accepted `TextMediaType` set (`text/csv`, `application/json`, `text/markdown`, `text/plain`) is a fixed constant, not a Loader-exposed knob, mirroring `imageLimits.mediaTypes`.

## Model Experience

Indirectly, through durable replay of historical user images and structured model image output after restart and fork.

#### KV Cache effect

None beyond the image block owned by the requesting adapter.

## Known Limitations and Deferred Work

- Objects are retained indefinitely; reference-aware garbage collection is deferred.
- The local backend assumes the host and provider adapter share this filesystem service.
- Animated GIF metadata is validated from the logical screen; frame-level decoding policy is provider-owned.
- A text file's declared `mediaType` is never verified against its content: `text/csv`, `application/json`, `text/markdown`, and `text/plain` carry no distinguishing byte-level signature the way a raster header does, so admission trusts the caller's declaration.
