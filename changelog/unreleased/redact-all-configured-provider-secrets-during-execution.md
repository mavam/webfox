---
title: Redact all configured provider secrets during execution
type: bugfix
authors:
  - mavam
prs:
  - 65
created: 2026-11-25T05:42:38.755057Z
---

Webfox now redacts all known configured and environment provider secrets from execution errors, progress updates, and results—not only the credentials resolved for the active provider. Previously, an error or custom command output echoing another configured provider's API key could pass through unredacted.

OpenAI and Gemini requests also now receive a stable per-input `Idempotency-Key` header across retries.
