---
title: Fix webfox/durable standalone peer isolation and ExecutionEnv spill files
type: bugfix
authors:
  - mavam
prs:
  - 67
created: 2026-11-25T06:03:46.546487Z
---

The `webfox/durable` entry point no longer imports `@earendil-works/pi-coding-agent` at runtime, so Pi Durable hosts can install and run `webfox/durable` without installing the Pi coding agent package.

Oversized tool results in `webfox/durable` are now written through the conversation's `ExecutionEnv` instead of local host temp directories, and truncated tool outputs keep their `Full results:` path inside the 2000-line / 50 KiB budget so Pi Durable's output limiter does not clip the file path.
