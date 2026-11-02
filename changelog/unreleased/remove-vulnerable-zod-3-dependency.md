---
title: Remove vulnerable zod 3 dependency
type: bugfix
authors:
  - mavam
created: 2026-11-02T08:37:24.480957Z
---

Installing webfox no longer pulls in zod 3.x, so `npm audit` no longer reports the high-severity zod advisory GHSA-mrhx-c7xc-m3w5. The Exa, Firecrawl, and Linkup providers now call their HTTP APIs directly instead of through provider SDKs that pinned the vulnerable zod release line. Provider options, results, and configuration stay the same, and cancellation now aborts in-flight requests to these providers.
