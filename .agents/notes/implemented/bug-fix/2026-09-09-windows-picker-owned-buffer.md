# Agent Note: Windows picker owned buffers

Status: implemented

English | [中文](2026-09-09-windows-picker-owned-buffer.zh.md)

## Problem

PaperMachine 0.1.1 still crashes in `readUtf16` after selecting a folder ([issue #5](https://github.com/SuperJJ007/papermachine/issues/5)). Exact allocation sizing prevents overreads but does not make `koffi.view` compatible with Electron's [V8 memory cage](https://www.electronjs.org/blog/v8-memory-cage), which rejects external ArrayBuffers.

## Decision

The Windows picker copies the COM allocation into `Buffer.alloc` memory using `RtlMoveMemory`, then decodes UTF-16. `lstrlenW` bounds the copy to the string plus its terminating NUL. COM allocation ownership and cleanup remain unchanged.

## Alternatives considered

**Exact-length external view:** still aborts in Electron 43.4.1 with `FATAL ERROR: Error::New napi_get_last_error_info`, including for a valid two-byte empty string allocation.

**Browse-only composition:** bypasses the crash but replaces the native interaction and leaves the native backend broken.

## Verification

The binding tests reject all external views and cover empty, ASCII, CJK, space-containing and surrogate-pair paths. A native `CoTaskMemAlloc` probe under the installed Electron 43.4.1 exits 134 for the view implementation and 0 for the copy implementation. Interactive selection through a rebuilt installer remains a separate acceptance check.

## Consequences

Each selection adds one bounded buffer allocation and memory copy. The picker works with Electron's memory cage without disabling runtime protections or changing the interaction protocol.
