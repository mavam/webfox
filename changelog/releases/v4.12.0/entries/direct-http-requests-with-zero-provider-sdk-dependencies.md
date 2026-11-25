---
title: Direct HTTP requests with zero provider SDK dependencies
type: change
authors:
  - mavam
prs:
  - 66
created: 2026-11-25T05:57:01.149629Z
---

Webfox no longer depends on any third-party provider SDK packages. The Cloudflare, OpenAI, Parallel, Perplexity, Tavily, and Valyu providers now call their REST APIs directly over HTTP, cutting standalone installs from 38 packages to 5.

All built-in HTTP providers—including Tavily and Valyu—now cancel in-flight HTTP requests directly when a timeout or cancellation signal fires. Provider options, CLI flags, configuration keys, and result formats remain unchanged.
