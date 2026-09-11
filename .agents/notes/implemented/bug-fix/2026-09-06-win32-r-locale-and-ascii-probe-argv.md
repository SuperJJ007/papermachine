# Agent Note: win32 R locale and non-ASCII probe argv both broke R's UTF-8 lossless-output check

Status: implemented

English | [中文](2026-09-06-win32-r-locale-and-ascii-probe-argv.zh.md)

## Problem

R probe results must not depend on a Windows console code page or on non-ASCII source text surviving argv conversion.

## Decision

R execution establishes the declared UTF-8 locale and probes UTF-8 behavior using ASCII source that constructs the intended code points. Probe transport, interpreter behavior, and returned bytes are checked separately. The source expression itself does not contain the non-ASCII glyph whose round trip is being measured.

## Alternatives considered

**Place the test glyph directly in command-line source.** A console or argv conversion can corrupt the probe before R evaluates it.

**Accept any locally displayed text as proof.** Display decoding can hide wrong returned bytes.

**Relax the UTF-8 check for Windows.** This would permit platform-dependent model-visible data.

## Consequences

The locale and ASCII probe avoid a reproducible encoding trap without proving every external library uses UTF-8. Historical Windows observations remain historical; current platform packaging and real-interpreter acceptance must be rerun against the shipped artifact.

## Related

Related owners: [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.md).
