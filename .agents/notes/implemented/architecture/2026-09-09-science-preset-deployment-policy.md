# Agent Note: Science preset deployment policy

Status: implemented

English | [中文](2026-09-09-science-preset-deployment-policy.zh.md)

## Problem

Science deployments need restricted tools, fixed preset policy, and visible effective settings across application surfaces.

## Decision

The Science preset composes a read-only filesystem entry and curated model tools. Copy eligibility is behavioral metadata enforced by both Host authoring and the client. Missing shipped metadata or invalid present metadata fails closed. MCP curation is resolved at load and checked against every discovered generation. Tool-result pruning may exempt instruction-bearing tools by their recorded call names.

## Consequences

Settings expose separately redacted saved and effective values. Restart-scoped owners retain their registration-time effective value; live owners advance both. Request retries restore retained runtime context after surface replacement without repeating provider work. science-headless shares the product preset and Host services with the Web profile. These policies add no compatibility format and supersede no active implementation note in this tree.

## Alternatives considered

A UI-only copy restriction can be bypassed by direct calls. Global host tools would leak capabilities into restricted preset scopes.
