# Agent Note: Science references retain user authorship and exported geometry

Status: implemented

English | [中文](2026-08-31-science-reference-authorship-and-geometry.zh.md)

## Problem

A selected artifact region must retain user authorship and exact image coordinates through cropping and composer insertion.

## Decision

Science registers its reference input through the owning Chat source. User-created selections remain user input instead of being classified from generic message text or a private composer slot. References name immutable versions. Rectangle coordinates are converted against the original PNG dimensions after crop transforms, rather than against a resized display element.

A cropped image and its metadata describe the same source rectangle; browser scale and layout changes must not alter the scientific region selected.

## Alternatives considered

**Infer authorship by scanning arbitrary content.** Generated text can resemble a user reference and acquire the wrong permissions or placement.

**Use rendered CSS pixels as source coordinates.** Resizing and cropping would silently select a different region.

**Introduce a second composer path.** This splits input ownership and bypasses native Chat registration.

## Consequences

Geometry tests need nontrivial crop offsets and scaling, not only an identity transform. Exact version references prevent later artifact updates from changing the meaning of an already submitted selection.

## Related

Related owners: [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md); [science-read-remotes](../architecture/2026-09-09-science-read-remotes.md).
