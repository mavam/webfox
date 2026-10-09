---
title: Identify webfox to the Perplexity API
type: change
authors:
  - qirh
created: 2026-10-09T13:30:00Z
---

Requests from the Perplexity provider to `api.perplexity.ai` now include an `X-Pplx-Integration: webfox` header so Perplexity can attribute API traffic to webfox. Custom base URLs and a caller-supplied `X-Pplx-Integration` in `PERPLEXITY_CUSTOM_HEADERS` are left unchanged.
