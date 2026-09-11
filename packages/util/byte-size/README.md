---
description: "Format byte counts as compact B, KB, and MB labels."
kind: "package-library"
---

# dsh-byte-size

English | [中文](README.zh.md)

## Summary

Format byte counts as compact B, KB, and MB labels. Callers can share size formatting across tool results and browser views. Unit abbreviations are fixed and do not follow the caller locale.

## Table of Contents

- [Package responsibilities](#package-section-0)
- [API](#package-section-1)
- [Usage shape](#package-section-2)
- [Runtime assertions](#package-section-3)
- [Model Experience](#package-section-4)
- [Known Limitations and Deferred Work](#package-section-5)
- [Dev Note](#dev-note)

<a id="package-section-0"></a>
## Package responsibilities

A zero-dependency library of one pure function — no runtime harness deps, no `ctx`, no state — shared by any capability or Client package that shows a file or attachment's byte count without owning byte-count display semantics itself.

<a id="package-section-1"></a>
## API

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
```

| Export | Role |
|---|---|
| `formatBytes(bytes)` | Human-readable byte count as a compact `B`/`KB`/`MB` label, one decimal place above 1024 bytes. |

<a id="package-section-2"></a>
## Usage shape

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'

formatBytes(0)               // '0 B'
formatBytes(1536)            // '1.5 KB'
formatBytes(5 * 1024 * 1024) // '5.0 MB'
```

<a id="package-section-3"></a>
## Runtime assertions

No runtime invariant companion is published: Byte formatting is a pure function with no events, retained state, or independent observations that can diverge.

<a id="package-section-4"></a>
## Model Experience

Indirectly, through consumers such as `dsh-tool-science`'s `run_python`/`run_r` result text, which appends one attachment byte count per captured-artifact line using this package's compact label.

#### KV Cache effect

No direct invalidation; each formatted label is appended as part of its consumer's own tool result, which owns its own append-only or replacement KV Cache behavior.

## Known Limitations and Deferred Work

<a id="package-section-5"></a>

- **Not localized** — the label's unit abbreviations are fixed regardless of caller locale. `dsh-client-ui-science`'s artifact size line interpolates the label into its own localized UI text; `dsh-tool-science`'s run summary renders it directly as unlocalized developer-facing text.

<a id="dev-note"></a>
### Dev Note

None.
