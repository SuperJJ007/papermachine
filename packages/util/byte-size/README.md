# dsh-byte-size

English | [中文](README.zh.md)

A zero-dependency library of one pure function — no runtime harness deps, no `ctx`, no state — shared by any capability or Client package that shows a file or attachment's byte count without owning byte-count display semantics itself.

## API

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
```

| Export | Role |
|---|---|
| `formatBytes(bytes)` | Human-readable byte count as a compact `B`/`KB`/`MB` label, one decimal place above 1024 bytes. |

## Usage shape

```ts
import { formatBytes } from '@deepseek-ai/dsh-byte-size'

formatBytes(0)               // '0 B'
formatBytes(1536)            // '1.5 KB'
formatBytes(5 * 1024 * 1024) // '5.0 MB'
```

## Model Experience

Indirectly, through consumers such as `dsh-tool-science`'s `run_python`/`run_r` result text, which appends one attachment byte count per captured-artifact line using this package's compact label.

#### KV Cache effect

No direct invalidation; each formatted label is appended as part of its consumer's own tool result, which owns its own append-only or replacement KV Cache behavior.

## Known Limitations and Deferred Work

- **Not localized** — every current consumer renders unlocalized model- or developer-facing text, the same register as an unlocalized file extension.
