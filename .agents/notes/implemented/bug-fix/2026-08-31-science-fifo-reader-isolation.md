# Agent Note: Keep persistent FIFO reads outside the Host filesystem pool

Status: implemented

English | [中文](2026-08-31-science-fifo-reader-isolation.zh.md)

## Problem

A Node filesystem stream reading an idle FIFO occupies a libuv filesystem worker until bytes arrive. Four persistent kernels exhaust the default pool, preventing unrelated file reads, artifact capture, session persistence, and run settlement even when the interpreters finish their work.

## Decision

Each kernel owns a `cat` subprocess that forwards its response FIFO to an ordinary subprocess stdout pipe. The Host reads that pipe through the event loop. Blocking FIFO open and read belong to the forwarding process, including when an interpreter never connects. The forwarder receives only its exact private FIFO path and an empty environment; it executes no scientific code. Startup failure waits for both process trees before removing the FIFO. Normal teardown reports both trees' bounded or eventual exit observations so the owner retains quarantine until both are proven quiescent.

The [persistent-kernel decision](../architecture/2026-08-20-science-persistent-kernel.md) remains authoritative for interpreter state, confinement, epochs, protocol, and cancellation. This changes only response transport ownership.

## Alternatives considered

**Increase `UV_THREADPOOL_SIZE`.** This moves the failure to a larger number of idle kernels and still lets persistent reads compete with unrelated Host work.

**Wrap a nonblocking FIFO descriptor in `net.Socket`.** The local macOS probe passes data and avoids pool starvation but fails to emit EOF after the writer closes. The existing unexpected-EOF regression rejects this loss of protocol-failure detection.

**Move responses to interpreter stdout.** Python can preserve and redirect descriptors; base R cannot isolate native stdout writes from protocol frames without additional runtime machinery. The FIFO retains the dependency-free, network-denied Python/R protocol.

## Consequences

Every live kernel adds one small forwarding process and requires POSIX `cat` alongside `mkfifo`. Host file I/O no longer depends on the number of idle interpreters. The communication tests cover four idle kernels, startup failure, protocol EOF, interrupts, and disposal; real acceptance keeps Python and R alive in two sessions while reading unrelated files, completing runs, cancelling, and proving test-owned process cleanup. The runnable Science snapshot keeps four kernels alive through artifact reads and session persistence.
